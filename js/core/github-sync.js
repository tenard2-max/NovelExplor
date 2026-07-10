/** GitHub 동기화 — JSON 스냅샷 분리 + PNG/MD/TXT 개별 커밋 */

import { buildBackupPayload, timestampBackupFilename } from './backup.js';
import { putRepoFiles } from './github-api.js';
import {
  getGithubConfig,
  hasGithubToken,
  snapshotsDir,
  overlaysDir,
} from './github-config.js';
import {
  setJsonVersionStamp,
  stampFromBackupFilename,
  refreshNavVersions,
} from '../app-version.js';
import { emit, on } from './events.js';
import { basename } from './utils.js';

let syncTimer = null;
let syncInFlight = false;

/** 저장·적용·업로드 후 디바운스 동기화 */
export function scheduleGithubSync(reason = 'change') {
  if (!hasGithubToken()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncProjectToGithub({ reason }).catch((err) => {
      console.warn('[github-sync]', err);
      emit('github:sync-error', err);
    });
  }, 1500);
}

/**
 * IndexedDB → GitHub (스냅샷 JSON + 분리 자산)
 * @returns {Promise<{ snapshotId: string, fileCount: number } | null>}
 */
export async function syncProjectToGithub({ snapshotId, reason = 'save' } = {}) {
  if (!hasGithubToken()) return null;
  if (syncInFlight) return null;

  syncInFlight = true;
  emit('github:sync-start', { reason });

  try {
    const payload = await buildBackupPayload({ lite: false });
    if (!payload) throw new Error('열린 프로젝트가 없습니다.');

    const stamp = snapshotId || timestampBackupFilename().replace(/\.json$/i, '');

    const { manifest, assetFiles } = splitPayloadForGithub(payload, stamp);
    const cfg = getGithubConfig();
    const snapDir = snapshotsDir(cfg);
    const files = [];

    for (const asset of assetFiles) {
      files.push({
        repoPath: asset.repoPath,
        content: asset.content,
        contentBase64: asset.contentBase64 === true,
      });
    }

    files.push({
      repoPath: `${snapDir}/${stamp}.json`,
      content: JSON.stringify(manifest, null, 2),
    });

    files.push({
      repoPath: `${snapDir}/latest.json`,
      content: JSON.stringify({
        snapshotId: stamp,
        filename: `${stamp}.json`,
        updatedAt: manifest.exportedAt,
        reason,
      }, null, 2),
    });

    await putRepoFiles(files, `NovelExplor: ${reason}`);

    setJsonVersionStamp(stamp);
    refreshNavVersions();
    emit('github:sync-done', { snapshotId: stamp, fileCount: files.length });
    return { snapshotId: stamp, fileCount: files.length };
  } finally {
    syncInFlight = false;
  }
}

/** 전체 백업 payload → GitHub용 분리 manifest + 바이너리/텍스트 파일 */
export function splitPayloadForGithub(payload, snapshotId) {
  const cfg = getGithubConfig();
  const root = overlaysDir(cfg);
  const assetFiles = [];
  const manifest = {
    format: 'novel-explor-github-snapshot',
    version: 1,
    snapshotId,
    exportedAt: payload.exportedAt,
    backupType: 'split',
    project: payload.project,
    stories: payload.stories,
    episodes: payload.episodes,
    worlds: payload.worlds,
    foreshadows: payload.foreshadows,
    timeline: payload.timeline,
    characterRelations: payload.characterRelations,
    characters: [],
    files: [],
    settings: {},
  };

  for (const ch of payload.characters || []) {
    const cid = ch.characterId || String(ch.id || '').split('-').pop() || 'CHR0000';
    const entry = { ...ch };
    delete entry.avatarDataUrl;
    delete entry.images;

    const avatar = ch.avatarDataUrl || ch.image || ch.avatar || '';
    if (avatar && String(avatar).startsWith('data:')) {
      const avatarPath = `${root}/characters/${cid}.png`;
      assetFiles.push({
        repoPath: avatarPath,
        content: dataUrlToBase64(avatar),
        contentBase64: true,
      });
      entry.avatarPath = avatarPath;
    }

    const galleryPaths = [];
    const images = Array.isArray(ch.images) ? ch.images : [];
    images.forEach((url, i) => {
      if (!url || url === avatar) return;
      if (!String(url).startsWith('data:')) return;
      const galleryPath = `${root}/characters/${cid}_${i + 1}.png`;
      assetFiles.push({
        repoPath: galleryPath,
        content: dataUrlToBase64(url),
        contentBase64: true,
      });
      galleryPaths.push(galleryPath);
    });
    if (galleryPaths.length) entry.imagePaths = galleryPaths;

    manifest.characters.push(entry);
  }

  for (const f of payload.files || []) {
    const name = basename(f.path || f.id || 'file.txt');
    const safe = name.replace(/[^\w.\-가-힣]/g, '_');
    const sub = safe.match(/\.(md|txt)$/i) ? 'stories' : 'files';
    const filePath = `${root}/${sub}/${safe}`;
    assetFiles.push({
      repoPath: filePath,
      content: f.content || '',
    });
    manifest.files.push({
      ...f,
      content: '',
      contentPath: filePath,
    });
  }

  const wp = payload.settings?.canvasWallpaper;
  if (wp?.dataUrl && String(wp.dataUrl).startsWith('data:')) {
    const wpPath = `${root}/wallpaper.png`;
    assetFiles.push({
      repoPath: wpPath,
      content: dataUrlToBase64(wp.dataUrl),
      contentBase64: true,
    });
    manifest.settings = {
      canvasWallpaper: { ...wp, dataUrl: '', dataPath: wpPath },
    };
  } else if (payload.settings) {
    manifest.settings = payload.settings;
  }

  return { manifest, assetFiles };
}

function dataUrlToBase64(dataUrl) {
  const s = String(dataUrl);
  const idx = s.indexOf(',');
  return idx >= 0 ? s.slice(idx + 1) : s;
}

export function initGithubSync() {
  const schedule = (reason) => () => scheduleGithubSync(reason);
  on('project:saved', schedule('db-edit'));
  on('character:updated', schedule('character-image'));
  on('character:deleted', schedule('character-delete'));
}
