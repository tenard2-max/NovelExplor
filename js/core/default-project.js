/** 기본 프로젝트 — 마스터가 지정, 일반 사용자는 열람만 */

import * as storage from './storage.js';
import { nowIso } from './utils.js';
import { canSetDefaultProject, getCurrentUser } from './auth.js';
import { getGithubConfig, snapshotsDir, hasGithubToken } from './github-config.js';
import { getRepoFileJson, listRepoDir } from './github-api.js';
import { pullProjectFromGithub } from './github-pull.js';
import { syncProjectToGithub, waitUntilGithubIdle } from './github-sync.js';
import { exportTimestampedBackup } from './backup.js';
import { getCurrentProject } from './project.js';
import { flushSave } from './autosave.js';

const SETTINGS_KEY = 'app-default-project';

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
 * @returns {Promise<{ snapshotId: string, name: string, label: string }[]>}
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
      };
    })
    .sort((a, b) => b.snapshotId.localeCompare(a.snapshotId));
}

function formatStampLabel(stamp) {
  const s = String(stamp || '').slice(0, 14);
  if (!/^\d{14}$/.test(s)) return stamp;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} `
    + `${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
}

/**
 * 마스터: 현재 프로젝트를 기본 프로젝트로 저장
 * 1) 로컬 DB·백업 파일 저장
 * 2) GitHub에 스냅샷 + default.json 포인터 커밋
 * @returns {Promise<{ snapshotId: string, filename: string }>}
 */
export async function saveAsDefaultProject() {
  const user = getCurrentUser();
  if (!canSetDefaultProject(user)) {
    throw new Error('기본 프로젝트는 마스터만 설정할 수 있습니다.');
  }
  const proj = getCurrentProject();
  if (!proj) throw new Error('열린 프로젝트가 없습니다.');
  if (!hasGithubToken()) {
    throw new Error(
      '기본 프로젝트 저장에는 GitHub PAT가 필요합니다.\n'
      + '우측 「파일」패널 → GitHub → Token 입력 후 「GitHub 설정 저장」을 눌러 주세요.'
    );
  }

  await flushSave(true);

  // 로컬 백업만 먼저 (GitHub는 아래에서 명시적으로 처리)
  const filename = await exportTimestampedBackup({
    notify: false,
    skipGithub: true,
  });
  const snapshotId = String(filename).replace(/\.json$/i, '');

  await waitUntilGithubIdle();
  let result;
  try {
    result = await syncProjectToGithub({
      snapshotId,
      reason: 'default',
      asDefault: true,
      defaultTitle: proj.title || '기본 프로젝트',
    });
  } catch (err) {
    throw new Error(`GitHub 업로드 실패: ${err?.message || err}`);
  }
  if (!result?.snapshotId) {
    throw new Error('GitHub 동기화가 시작되지 않았습니다. 잠시 후 다시 시도하세요.');
  }

  const meta = {
    snapshotId: result.snapshotId,
    title: proj.title || '기본 프로젝트',
    updatedAt: nowIso(),
    filename: `${result.snapshotId}.json`,
  };
  await setLocalDefaultMeta(meta);
  return { snapshotId: meta.snapshotId, filename: meta.filename };
}

/**
 * 기본 프로젝트 불러오기 (GitHub default → 로컬 메타)
 * @returns {Promise<string|null>} snapshotId
 */
export async function loadDefaultProject({ skipConfirm = false } = {}) {
  let meta = await fetchGithubDefaultMeta();
  if (!meta) meta = await getLocalDefaultMeta();
  if (!meta?.snapshotId) {
    throw new Error('설정된 기본 프로젝트가 없습니다. 마스터가 먼저 지정해야 합니다.');
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
