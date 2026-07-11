/** GitHub → IndexedDB Pull (latest.json + 분리 자산 복원) */

import {
  getRepoFileJson,
  getRepoFileText,
  getRepoFileBase64,
} from './github-api.js';
import {
  getGithubConfig,
  snapshotsDir,
  overlaysDir,
} from './github-config.js';
import { restoreFromBackup } from './backup.js';
import {
  setJsonVersionStamp,
  setUploadVersionStamp,
  refreshNavVersions,
  refreshNavVersionsFromGithub,
} from '../app-version.js';
import { invalidateSection, replaceManifestText } from './workspace-xml.js';
import { emit } from './events.js';
import { getCurrentProject } from './project.js';
import { showDialog, showAlert } from '../ui/dialog.js';

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** split manifest → foreshadow-backup 전체 payload */
export async function hydrateManifestFromGithub(manifest) {
  const payload = {
    format: 'foreshadow-backup',
    version: 1,
    backupType: 'full',
    exportedAt: manifest.exportedAt,
    project: manifest.project,
    stories: manifest.stories || [],
    episodes: manifest.episodes || [],
    worlds: manifest.worlds || [],
    foreshadows: manifest.foreshadows || [],
    timeline: manifest.timeline || [],
    characterRelations: manifest.characterRelations || [],
    characters: [],
    files: [],
    settings: {},
  };

  for (const ch of manifest.characters || []) {
    const entry = { ...ch };
    delete entry.avatarPath;
    delete entry.imagePaths;

    if (ch.avatarPath) {
      const b64 = await getRepoFileBase64(ch.avatarPath);
      entry.avatarDataUrl = `data:image/png;base64,${b64}`;
    }

    if (Array.isArray(ch.imagePaths) && ch.imagePaths.length) {
      entry.images = [];
      for (const p of ch.imagePaths) {
        const b64 = await getRepoFileBase64(p);
        entry.images.push(`data:image/png;base64,${b64}`);
      }
    }

    payload.characters.push(entry);
  }

  for (const f of manifest.files || []) {
    let content = f.content || '';
    if (f.contentPath) {
      content = await getRepoFileText(f.contentPath);
    }
    const next = { ...f, content };
    delete next.contentPath;
    payload.files.push(next);
  }

  const wp = manifest.settings?.canvasWallpaper;
  if (wp?.dataPath) {
    const b64 = await getRepoFileBase64(wp.dataPath);
    payload.settings = {
      canvasWallpaper: {
        ...wp,
        dataUrl: `data:image/png;base64,${b64}`,
        dataPath: undefined,
      },
    };
  } else if (manifest.settings) {
    payload.settings = manifest.settings;
  }

  return payload;
}

async function refreshWorkspaceCacheFromGithub(cfg) {
  try {
    const wsXml = await getRepoFileText(`${cfg.workspaceRoot}/workspace.xml`);
    replaceManifestText(wsXml);
  } catch {
    /* workspace.xml 미반영 */
  }
  invalidateSection();
}

/**
 * GitHub latest.json 기준으로 IndexedDB 복원
 * @returns {Promise<string>} snapshotId
 */
export async function pullProjectFromGithub({
  snapshotId,
  replaceAll = true,
  skipConfirm = false,
} = {}) {
  // 공개 저장소는 PAT 없이 읽기 가능 (list/get allowPublic)
  const cfg = getGithubConfig();
  const snapDir = snapshotsDir(cfg);

  let id = snapshotId;
  if (!id) {
    const latest = await getRepoFileJson(`${snapDir}/latest.json`);
    id = latest?.snapshotId;
    if (!id && latest?.filename) {
      id = String(latest.filename).replace(/\.json$/i, '');
    }
  }
  if (!id) throw new Error('GitHub에 스냅샷(latest.json)이 없습니다.');

  const manifest = await getRepoFileJson(`${snapDir}/${id}.json`);
  if (!manifest?.project) {
    throw new Error(`스냅샷을 읽을 수 없습니다: ${id}.json`);
  }

  if (!skipConfirm) {
    const title = manifest.project?.title || '프로젝트';
    const when = manifest.exportedAt
      ? new Date(manifest.exportedAt).toLocaleString('ko-KR')
      : id;
    const confirmed = await showDialog({
      title: 'GitHub에서 Pull',
      bodyHtml: `<p><strong>${esc(title)}</strong></p>
        <p>스냅샷: <code>${esc(id)}.json</code><br>시각: ${esc(when)}</p>
        <p>적용 시 이 브라우저 DB의 기존 프로젝트는 <strong>GitHub 기준으로 교체</strong>됩니다. 계속할까요?</p>`,
    });
    if (!confirmed) return null;
  }

  const full = await hydrateManifestFromGithub(manifest);
  const jsonText = JSON.stringify(full, null, 2);

  await restoreFromBackup(jsonText, {
    replaceAll,
    sourceFilename: `${id}.json`,
    exportedAt: full.exportedAt,
  });

  setJsonVersionStamp(id);

  try {
    const uploadMeta = await getRepoFileJson(`${overlaysDir(cfg)}/upload-latest.json`);
    const uploadId = uploadMeta?.uploadId || uploadMeta?.snapshotId;
    if (uploadId) setUploadVersionStamp(uploadId);
  } catch {
    /* upload-latest 없음 */
  }

  refreshNavVersions();
  await refreshWorkspaceCacheFromGithub(cfg);

  emit('project:loaded', getCurrentProject());
  return id;
}

/** Pull 완료 알림 포함 */
export async function pullProjectFromGithubWithAlert(options = {}) {
  const id = await pullProjectFromGithub(options);
  if (!id) return null;
  await refreshNavVersionsFromGithub();
  await showAlert('GitHub Pull', `복원 완료: <code>${esc(id)}.json</code>`);
  return id;
}
