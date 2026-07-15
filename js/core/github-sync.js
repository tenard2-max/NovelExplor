/** GitHub 동기화 — JSON 스냅샷 분리 + PNG/MD/TXT 개별 커밋 */

import { buildBackupPayload, timestampBackupFilename } from './backup.js';
import {
  commitRepoFiles,
  fetchGithubRateLimit,
  getRepoFileJson,
  GITHUB_RATE_LIMIT_WARN_THRESHOLD,
} from './github-api.js';
import { showDialog } from '../ui/dialog.js';
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
import { emit } from './events.js';
import { basename, nowIso } from './utils.js';

let syncInFlight = false;
let progressClearTimer = null;
let githubSyncSuppressDepth = 0;

export function isGithubSyncSuppressed() {
  return githubSyncSuppressDepth > 0;
}

/** 프로젝트 복원·일괄 import 중 GitHub 자동 동기화 차단 */
export async function suppressGithubSyncDuring(fn) {
  githubSyncSuppressDepth += 1;
  try {
    return await fn();
  } finally {
    githubSyncSuppressDepth = Math.max(0, githubSyncSuppressDepth - 1);
  }
}

export function isGithubSyncInFlight() {
  return syncInFlight;
}

/** 진행 중인 GitHub 동기화가 끝날 때까지 대기 */
export async function waitUntilGithubIdle(timeoutMs = 120000) {
  const start = Date.now();
  while (syncInFlight) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('GitHub 동기화 대기 시간 초과. 잠시 후 다시 시도하세요.');
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** 업로드 전용 — PNG·MD·TXT 등 (JSON 스냅샷 버전은 갱신하지 않음) */
const UPLOAD_REASONS = new Set([
  'character-image',
  'character-delete',
  'file-upload',
  'wallpaper-upload',
]);

/** 사용자가 시작한 동기화 — API 잔량 경고 대상 */
const RATE_LIMIT_CHECK_REASONS = new Set(['save', 'default', 'manual']);

/**
 * PAT가 있고 API 잔량이 GITHUB_RATE_LIMIT_WARN_THRESHOLD 미만이면 확인 대화상자.
 * @returns {Promise<boolean>} true = 진행, false = 취소
 */
export async function confirmGithubSyncIfLowQuota() {
  if (!hasGithubToken()) return true;

  let rl;
  try {
    rl = await fetchGithubRateLimit();
  } catch {
    return true;
  }

  if (typeof rl?.remaining !== 'number') return true;
  if (rl.remaining >= GITHUB_RATE_LIMIT_WARN_THRESHOLD) return true;

  const limit = typeof rl.limit === 'number' ? rl.limit : 5000;
  return showDialog({
    title: 'GitHub API 잔량',
    bodyHtml: `<p>지금 등록이 일부 실패할 수 있습니다. 토큰량(API 잔량)을 확인해 주세요.</p>
      <p>현재 잔량: <strong>${rl.remaining}/${limit}</strong></p>
      <p>그래도 GitHub 동기화를 진행할까요?</p>`,
  });
}

/**
 * 자동 GitHub 동기화는 사용하지 않는다.
 * 편집·파일·이미지 변경은 IndexedDB에만 자동 저장하며,
 * GitHub 반영은 프로젝트 저장/기본 프로젝트 저장/수동 동기화에서
 * syncProjectToGithub()를 직접 호출할 때만 수행한다.
 *
 * 기존 호출부와의 호환성을 위해 no-op으로 유지한다.
 */
export function scheduleGithubSync() {
  return false;
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
  skipRateLimitCheck = false,
  characterId = '',
} = {}) {
  if (!hasGithubToken()) return null;
  if (isGithubSyncSuppressed() && reason !== 'manual') return null;

  if (!skipRateLimitCheck && RATE_LIMIT_CHECK_REASONS.has(reason)) {
    const proceed = await confirmGithubSyncIfLowQuota();
    if (!proceed) return null;
  }

  // 진행 중이면 대기 후 이어서 업로드 (예전엔 일반 저장이 조용히 스킵되어 원격 목록이 안 늘었음)
  if (syncInFlight) {
    await waitUntilGithubIdle();
  }
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

    let { manifest, assetFiles } = splitPayloadForGithub(payload, stamp);
    if (uploadOnly) {
      assetFiles = filterUploadOnlyAssets(assetFiles, { reason, characterId, manifest });
    }
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

      // character-image 등 uploadOnly는 PNG만 올리고 스냅샷 JSON을 안 갱신해
      // 다른 브라우저가 avatarPath 없는 manifest를 읽는 문제 방지
      try {
        const latest = await getRepoFileJson(`${snapDir}/latest.json`);
        const snapId = latest?.snapshotId
          || (latest?.filename ? String(latest.filename).replace(/\.json$/i, '') : '');
        if (snapId) {
          const patchManifest = { ...manifest, snapshotId: snapId };
          files.push({
            repoPath: `${snapDir}/${snapId}.json`,
            content: JSON.stringify(patchManifest, null, 2),
          });
        }
      } catch (err) {
        console.warn('[github-sync] latest 스냅샷 manifest 갱신 스킵:', err);
      }
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
    sceneCuts: [],
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

  for (const sceneCut of payload.sceneCuts || []) {
    const sceneCutId = sceneCut.sceneCutId
      || String(sceneCut.id || '').split('-').filter(Boolean).pop()
      || 'SCN0000';
    const entry = { ...sceneCut };
    const image = String(sceneCut.image || '').trim();

    if (image.startsWith('data:')) {
      delete entry.image;
      const mime = dataUrlMime(image);
      const extension = mime === 'image/jpeg'
        ? 'jpg'
        : mime === 'image/webp'
          ? 'webp'
          : 'png';
      const imagePath = `${root}/scene-cuts/${sceneCutId}.${extension}`;
      assetFiles.push({
        repoPath: imagePath,
        content: dataUrlToBase64(image),
        contentBase64: true,
      });
      entry.imagePath = imagePath;
      entry.imageMime = mime;
    }

    manifest.sceneCuts.push(entry);
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

function dataUrlMime(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)[;,]/i);
  return match?.[1]?.toLowerCase() || 'image/png';
}

/** uploadOnly 동기화 — 변경된 자산만 (전체 프로젝트 재업로드 방지) */
function filterUploadOnlyAssets(assetFiles, { reason, characterId, manifest }) {
  if (!assetFiles?.length) return assetFiles;

  if (reason === 'character-image' && characterId) {
    const ch = (manifest?.characters || []).find(
      (c) => c.id === characterId || `${c.projectId || ''}-${c.characterId || ''}` === characterId
    );
    const cid = ch?.characterId
      || String(characterId).split('-').filter(Boolean).pop()
      || '';
    if (!cid) return assetFiles;
    const prefix = `/characters/${cid}`;
    return assetFiles.filter((a) => String(a.repoPath).includes(prefix));
  }

  if (reason === 'character-delete' && characterId) {
    const cid = String(characterId).split('-').filter(Boolean).pop() || '';
    if (!cid) return [];
    const prefix = `/characters/${cid}`;
    return assetFiles.filter((a) => String(a.repoPath).includes(prefix));
  }

  if (reason === 'wallpaper-upload') {
    return assetFiles.filter((a) => /\/wallpaper\.png$/i.test(String(a.repoPath)));
  }

  return assetFiles;
}

export function initGithubSync() {
  // 자동 이벤트 구독 없음: 실시간 변경은 IndexedDB에만 저장한다.
}
