/** 기본 프로젝트 — 일반 스냅샷과 동일, 사용자가 브라우저에 프로젝트가 없을 때 자동 로드용 포인터 */

import * as storage from './storage.js';
import { nowIso } from './utils.js';
import { canSetDefaultProject, getCurrentUser, isMaster } from './auth.js';
import { getGithubConfig, snapshotsDir, hasGithubToken } from './github-config.js';
import { getRepoFileJson, listRepoDir, deleteRepoPaths, commitRepoFiles } from './github-api.js';
import { pullProjectFromGithub } from './github-pull.js';
import { syncProjectToGithub, waitUntilGithubIdle } from './github-sync.js';
import { exportTimestampedBackup, buildBackupJson, restoreFromBackup } from './backup.js';
import { getCurrentProject } from './project.js';
import { flushSave } from './autosave.js';
import { emit } from './events.js';

const SETTINGS_KEY = 'app-default-project';
const BACKUP_KEY = 'app-default-project-backup';

/**
 * @typedef {{ snapshotId: string, title: string, updatedAt: string, filename?: string }} DefaultProjectMeta
 */

/** @returns {Promise<DefaultProjectMeta | null>} */
export async function getLocalDefaultMeta() {
  const row = await storage.get('settings', SETTINGS_KEY);
  if (!row?.snapshotId) return null;
  return {
    snapshotId: row.snapshotId,
    title: row.title || '기본 프로젝트',
    updatedAt: row.updatedAt || '',
    filename: row.filename || `${row.snapshotId}.json`,
  };
}

/** @param {DefaultProjectMeta} meta */
export async function setLocalDefaultMeta(meta) {
  await storage.put('settings', {
    id: SETTINGS_KEY,
    snapshotId: meta.snapshotId,
    title: meta.title || '기본 프로젝트',
    updatedAt: meta.updatedAt || nowIso(),
    filename: meta.filename || `${meta.snapshotId}.json`,
  });
}

/** GitHub snapshots/default.json 읽기 (공개 저장소는 PAT 없이 가능) */
export async function fetchGithubDefaultMeta() {
  const cfg = getGithubConfig();
  const snapDir = snapshotsDir(cfg);
  try {
    const meta = await getRepoFileJson(`${snapDir}/default.json`);
    if (!meta?.snapshotId && !meta?.filename) return null;
    const snapshotId = meta.snapshotId
      || String(meta.filename || '').replace(/\.json$/i, '');
    if (!snapshotId) return null;
    return {
      snapshotId,
      title: meta.title || '기본 프로젝트',
      updatedAt: meta.updatedAt || '',
      filename: meta.filename || `${snapshotId}.json`,
    };
  } catch {
    return null;
  }
}

/**
 * GitHub 스냅샷 목록 (YYYYMMDDHHMMSS.json / YYYYMMDDHHMMSS_테마.json)
 * @returns {Promise<{ snapshotId: string, name: string, label: string, size?: number }[]>}
 */
export async function listGithubProjectSnapshots() {
  const cfg = getGithubConfig();
  const snapDir = snapshotsDir(cfg);
  const entries = await listRepoDir(snapDir);
  const stampRe = /^(\d{14})(?:_([^.]+))?\.json$/i;

  return entries
    .filter((e) => e.type === 'file' && stampRe.test(e.name))
    .map((e) => {
      const m = e.name.match(stampRe);
      const stamp = m?.[1] || e.name.replace(/\.json$/i, '');
      const theme = m?.[2] || '';
      const snapshotId = e.name.replace(/\.json$/i, '');
      return {
        snapshotId,
        name: e.name,
        label: theme ? `${formatStampLabel(stamp)} · ${theme}` : formatStampLabel(stamp),
        size: e.size || 0,
      };
    })
    .sort((a, b) => b.snapshotId.localeCompare(a.snapshotId));
}

/**
 * 스냅샷 JSON에서 프로젝트 제목·작성자·writers 메타를 채워 전체 목록 반환 (마스터 관리용)
 * @returns {Promise<{
 *   snapshotId: string, name: string, label: string, size: number,
 *   title: string, author: string, writers: string[], ownerId: string, exportedAt: string
 * }[]>}
 */
export async function listGithubProjectsDetailed() {
  const list = await listGithubProjectSnapshots();
  const cfg = getGithubConfig();
  const snapDir = snapshotsDir(cfg);
  const out = [];
  const batch = 4;

  for (let i = 0; i < list.length; i += batch) {
    const chunk = list.slice(i, i + batch);
    const metas = await Promise.all(chunk.map(async (s) => {
      try {
        const data = await getRepoFileJson(`${snapDir}/${s.name}`);
        const project = data?.project || {};
        return {
          ...s,
          title: project.title || data?.title || '(제목 없음)',
          author: project.author || '',
          writers: Array.isArray(project.writers) ? project.writers : [],
          ownerId: project.ownerId || '',
          exportedAt: data?.exportedAt || project.updatedAt || '',
        };
      } catch {
        return {
          ...s,
          title: '(메타 읽기 실패)',
          author: '',
          writers: [],
          ownerId: '',
          exportedAt: '',
        };
      }
    }));
    out.push(...metas);
  }
  return out;
}

function formatStampLabel(stamp) {
  const s = String(stamp || '').slice(0, 14);
  if (!/^\d{14}$/.test(s)) return stamp;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} `
    + `${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
}

/**
 * 마스터: GitHub 타임스탬프 스냅샷 JSON 삭제
 * latest/default 포인터가 가리키면 남은 최신으로 갱신하거나 포인터 파일도 제거
 * @param {string[]} snapshotIds 파일명에서 .json 제외 (예: 20260711120000_테마)
 * @returns {Promise<{ deleted: string[], latestUpdated: boolean, defaultUpdated: boolean }>}
 */
export async function deleteGithubProjectSnapshots(snapshotIds) {
  if (!isMaster()) throw new Error('마스터만 GitHub 스냅샷을 삭제할 수 있습니다.');
  if (!hasGithubToken()) {
    throw new Error('GitHub Personal Access Token이 필요합니다. 우측 패널에서 연결하세요.');
  }

  const ids = [...new Set((snapshotIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw new Error('삭제할 스냅샷을 선택하세요.');

  const cfg = getGithubConfig();
  const snapDir = snapshotsDir(cfg);
  const deleteSet = new Set(ids);

  const before = await listGithubProjectSnapshots();
  const toDelete = before.filter((s) => deleteSet.has(s.snapshotId));
  if (!toDelete.length) throw new Error('선택한 스냅샷을 저장소에서 찾지 못했습니다.');

  let latestMeta = null;
  let defaultMeta = null;
  try {
    latestMeta = await getRepoFileJson(`${snapDir}/latest.json`);
  } catch { /* none */ }
  try {
    defaultMeta = await getRepoFileJson(`${snapDir}/default.json`);
  } catch { /* none */ }

  const paths = toDelete.map((s) => `${snapDir}/${s.name}`);
  const deletedIds = new Set(toDelete.map((s) => s.snapshotId));
  const remaining = before.filter((s) => !deletedIds.has(s.snapshotId));
  const nextLatest = remaining[0] || null;

  const pointerWrites = [];
  let latestUpdated = false;
  let defaultUpdated = false;

  const latestPointsDeleted = latestMeta
    && deletedIds.has(String(latestMeta.snapshotId || '').replace(/\.json$/i, ''));
  if (latestPointsDeleted) {
    if (nextLatest) {
      pointerWrites.push({
        repoPath: `${snapDir}/latest.json`,
        content: JSON.stringify({
          snapshotId: nextLatest.snapshotId,
          filename: nextLatest.name,
          updatedAt: nowIso(),
          reason: 'delete-repoint',
        }, null, 2),
      });
      latestUpdated = true;
    } else {
      paths.push(`${snapDir}/latest.json`);
      latestUpdated = true;
    }
  }

  const defaultId = defaultMeta?.snapshotId
    || String(defaultMeta?.filename || '').replace(/\.json$/i, '');
  if (defaultMeta && deletedIds.has(String(defaultId))) {
    if (nextLatest) {
      pointerWrites.push({
        repoPath: `${snapDir}/default.json`,
        content: JSON.stringify({
          snapshotId: nextLatest.snapshotId,
          filename: nextLatest.name,
          title: defaultMeta.title || '기본 프로젝트',
          updatedAt: nowIso(),
          reason: 'delete-repoint',
        }, null, 2),
      });
      defaultUpdated = true;
    } else {
      paths.push(`${snapDir}/default.json`);
      defaultUpdated = true;
    }
  }

  const names = toDelete.map((s) => s.name).join(', ');
  await deleteRepoPaths(
    paths,
    `NovelExplor: delete snapshot(s) ${names}`
  );

  if (pointerWrites.length) {
    await commitRepoFiles(
      pointerWrites,
      `NovelExplor: repoint after snapshot delete`
    );
  }

  emit('github:snapshots-changed', { deleted: toDelete.map((s) => s.snapshotId) });
  return {
    deleted: toDelete.map((s) => s.name),
    latestUpdated,
    defaultUpdated,
  };
}

/**
 * 마스터: 현재 프로젝트를 기본으로 지정
 * - 일반 프로젝트 저장과 동일 (타임스탬프 JSON)
 * - 로컬 IndexedDB에 백업 보관 → 사용자 자동 로드용
 * - GitHub PAT가 있으면 default.json 포인터도 시도 (실패해도 로컬 지정은 성공)
 * @returns {Promise<{ snapshotId: string, filename: string, githubOk: boolean, githubError: string }>}
 */
export async function saveAsDefaultProject() {
  const user = getCurrentUser();
  if (!canSetDefaultProject(user)) {
    throw new Error('기본 프로젝트는 마스터만 설정할 수 있습니다.');
  }
  const proj = getCurrentProject();
  if (!proj) throw new Error('열린 프로젝트가 없습니다.');

  await flushSave(true);

  // 일반 저장과 동일 — 테마 태그만 default 로 구분 (없어도 됨)
  const filename = await exportTimestampedBackup({
    notify: false,
    theme: 'default',
    skipGithub: true,
  });
  const snapshotId = String(filename).replace(/\.json$/i, '');

  // 로컬 전체 백업 보관 (브라우저에 프로젝트 없을 때 자동 로드)
  const jsonText = await buildBackupJson({ lite: false });
  if (!jsonText) throw new Error('백업 데이터를 만들 수 없습니다.');

  await storage.put('settings', {
    id: BACKUP_KEY,
    jsonText,
    snapshotId,
    title: proj.title || '기본 프로젝트',
    updatedAt: nowIso(),
  });

  const meta = {
    snapshotId,
    title: proj.title || '기본 프로젝트',
    updatedAt: nowIso(),
    filename,
  };
  await setLocalDefaultMeta(meta);

  let githubOk = false;
  let githubError = '';
  if (hasGithubToken()) {
    try {
      await waitUntilGithubIdle();
      const result = await syncProjectToGithub({
        snapshotId,
        reason: 'default',
        asDefault: true,
        defaultTitle: proj.title || '기본 프로젝트',
      });
      githubOk = Boolean(result?.snapshotId);
      if (!githubOk) {
        githubError = 'GitHub 동기화가 시작되지 않았습니다.';
      }
    } catch (err) {
      githubError = err?.message || String(err);
      console.warn('[default-project] GitHub 반영 실패(로컬 지정은 완료):', err);
    }
  } else {
    githubError = 'GitHub PAT 없음 — 로컬만 지정됨';
  }

  return {
    snapshotId: meta.snapshotId,
    filename: meta.filename,
    githubOk,
    githubError,
  };
}

/**
 * 기본 프로젝트 불러오기
 * 1) 로컬 IndexedDB 백업  2) GitHub default.json  3) 로컬 메타+GitHub 스냅샷
 * @returns {Promise<string|null>} snapshotId
 */
export async function loadDefaultProject({ skipConfirm = false } = {}) {
  // 1) 로컬 백업 (마스터가 이 브라우저에서 지정한 경우)
  const localBackup = await storage.get('settings', BACKUP_KEY);
  if (localBackup?.jsonText) {
    await restoreFromBackup(localBackup.jsonText, {
      replaceAll: true,
      sourceFilename: localBackup.filename || `${localBackup.snapshotId || 'default'}.json`,
      exportedAt: localBackup.updatedAt || '',
    });
    emit('project:loaded', getCurrentProject());
    if (localBackup.snapshotId) {
      await setLocalDefaultMeta({
        snapshotId: localBackup.snapshotId,
        title: localBackup.title || '기본 프로젝트',
        updatedAt: localBackup.updatedAt || nowIso(),
        filename: localBackup.filename || `${localBackup.snapshotId}.json`,
      });
    }
    return localBackup.snapshotId || 'local-default';
  }

  // 2) GitHub default 포인터
  let meta = await fetchGithubDefaultMeta();
  if (!meta) meta = await getLocalDefaultMeta();
  if (!meta?.snapshotId) {
    throw new Error('설정된 기본 프로젝트가 없습니다. 마스터가 「기본 프로젝트 저장」으로 지정해야 합니다.');
  }

  const id = await pullProjectFromGithub({
    snapshotId: meta.snapshotId,
    skipConfirm,
    replaceAll: true,
  });
  if (id) {
    await setLocalDefaultMeta({
      ...meta,
      snapshotId: id,
      updatedAt: nowIso(),
    });
  }
  return id;
}
