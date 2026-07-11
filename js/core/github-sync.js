/** GitHub 동기화 — JSON 스냅샷 분리 + PNG/MD/TXT 개별 커밋 */

import { buildBackupPayload, timestampBackupFilename } from './backup.js';
import { commitRepoFiles } from './github-api.js';
import { buildSectionXmlFiles } from './xml-section-writer.js';
import {
  getGithubConfig,
  hasGithubToken,
  snapshotsDir,
  overlaysDir,
} from './github-config.js';
import {
  setJsonVersionStamp,
  setUploadVersionStamp,
  stampFromDate,
  refreshNavVersions,
  setNavSyncProgress,
  clearNavSyncProgress,
} from '../app-version.js';
import { emit, on } from './events.js';
import { basename, nowIso } from './utils.js';

let syncTimer = null;
let syncInFlight = false;
let pendingReason = 'change';
let progressClearTimer = null;

/** 업로드 전용 — PNG·MD·TXT 등 (JSON 스냅샷 버전은 갱신하지 않음) */
const UPLOAD_REASONS = new Set([
  'character-image',
  'character-delete',
  'file-upload',
  'wallpaper-upload',
]);

/** 저장·적용·업로드 후 디바운스 동기화 */
export function scheduleGithubSync(reason = 'change') {
  if (!hasGithubToken()) return;
  pendingReason = reason;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const r = pendingReason;
    pendingReason = 'change';
    syncProjectToGithub({ reason: r }).catch((err) => {
      console.warn('[github-sync]', err);
      setNavSyncProgress(`실패: ${err.message || err}`, { error: true });
      emit('github:sync-error', err);
    });
  }, 1500);
}

function onCommitProgress(p) {
  const label = p?.label || '';
  setNavSyncProgress(label);
  emit('github:sync-progress', p);
}

/**
 * IndexedDB → GitHub
 * @returns {Promise<{ snapshotId: string, fileCount: number, uploadId?: string } | null>}
 */
export async function syncProjectToGithub({
  snapshotId,
  reason = 'save',
  asDefault = false,
  defaultTitle = '',
} = {}) {
  if (!hasGithubToken()) return null;
  if (syncInFlight) return null;

  const uploadOnly = UPLOAD_REASONS.has(reason);
  syncInFlight = true;
  clearTimeout(progressClearTimer);
  setNavSyncProgress('동기화 준비…');
  emit('github:sync-start', { reason, uploadOnly, asDefault });

  try {
    const payload = await buildBackupPayload({ lite: false });
    if (!payload) throw new Error('열린 프로젝트가 없습니다.');

    const stamp = snapshotId
      || (uploadOnly ? stampFromDate(new Date()) : timestampBackupFilename().replace(/\.json$/i, ''));

    const { manifest, assetFiles } = splitPayloadForGithub(payload, stamp);
    const cfg = getGithubConfig();
    const snapDir = snapshotsDir(cfg);
    const overlayRoot = overlaysDir(cfg);
    const files = [];

    for (const asset of assetFiles) {
      files.push({
        repoPath: asset.repoPath,
        content: asset.content,
        contentBase64: asset.contentBase64 === true,
      });
    }

    if (uploadOnly) {
      files.push({
        repoPath: `${overlayRoot}/upload-latest.json`,
        content: JSON.stringify({
          uploadId: stamp,
          updatedAt: nowIso(),
          reason,
        }, null, 2),
      });
    } else {
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
      if (asDefault || reason === 'default') {
        files.push({
          repoPath: `${snapDir}/default.json`,
          content: JSON.stringify({
            snapshotId: stamp,
            filename: `${stamp}.json`,
            title: defaultTitle || payload.project?.title || '기본 프로젝트',
            updatedAt: manifest.exportedAt || nowIso(),
            reason: 'default',
          }, null, 2),
        });
      }
    }

    for (const xml of buildSectionXmlFiles(payload, cfg)) {
      files.push({ repoPath: xml.repoPath, content: xml.content });
    }

    const commitMsg = uploadOnly
      ? `NovelExplor: ${reason} (${files.length} files)`
      : asDefault || reason === 'default'
        ? `NovelExplor: set default project ${stamp} (${files.length} files)`
        : `NovelExplor: ${reason} snapshot ${stamp} (${files.length} files)`;
    await commitRepoFiles(files, commitMsg, { onProgress: onCommitProgress });

    if (uploadOnly) {
      setUploadVersionStamp(stamp);
    } else {
      setJsonVersionStamp(stamp);
    }
    refreshNavVersions();
    setNavSyncProgress(`완료 ${files.length}파일 (100%)`);
    progressClearTimer = setTimeout(() => clearNavSyncProgress(), 6000);
    emit('github:sync-done', { snapshotId: stamp, fileCount: files.length, uploadOnly, asDefault });
    return { snapshotId: stamp, fileCount: files.length, uploadId: uploadOnly ? stamp : undefined };
  } catch (err) {
    setNavSyncProgress(`실패: ${err.message || err}`, { error: true });
    throw err;
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
    let sub = 'files';
    if (String(f.path || '').startsWith('CharacterCards/') || /^CHR\d+/i.test(safe)) {
      sub = 'characters';
    } else if (/\.(md|txt)$/i.test(safe)) {
      sub = 'stories';
    }
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
  on('character:updated', schedule('character-image'));
  on('character:deleted', schedule('character-delete'));
  on('upload:committed', schedule('file-upload'));
  on('wallpaper:updated', schedule('wallpaper-upload'));
  on('timeline:updated', schedule('change'));
}
