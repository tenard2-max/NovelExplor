/** GitHub split 스냅샷 → foreshadow-backup (overlay PNG → data URL) */

import {
  getRepoFileText,
  getRepoFileBase64,
  listRepoDir,
} from './github-api.js';
import { getGithubConfig, overlaysDir } from './github-config.js';

export function isGithubSplitManifest(data) {
  return data?.format === 'novel-explor-github-snapshot'
    || data?.backupType === 'split';
}

function characterIdOf(ch) {
  return ch.characterId
    || String(ch.id || '').split('-').filter(Boolean).pop()
    || 'CHR0000';
}

async function tryFetchPngAsDataUrl(repoPath) {
  if (!repoPath) return '';
  try {
    const b64 = await getRepoFileBase64(repoPath);
    return b64 ? `data:image/png;base64,${b64}` : '';
  } catch {
    return '';
  }
}

async function tryFetchImageAsDataUrl(repoPath, mime = 'image/png') {
  if (!repoPath) return '';
  try {
    const b64 = await getRepoFileBase64(repoPath);
    return b64 ? `data:${mime || 'image/png'};base64,${b64}` : '';
  } catch {
    return '';
  }
}

/** split manifest → foreshadow-backup 전체 payload */
export async function hydrateManifestFromGithub(manifest) {
  const cfg = getGithubConfig();
  const overlayRoot = overlaysDir(cfg);
  const charactersDir = `${overlayRoot}/characters`;

  /** @type {{ name: string, path: string, type: string }[] | null} */
  let overlayListing = null;
  async function listCharacterOverlays() {
    if (overlayListing === null) {
      try {
        overlayListing = await listRepoDir(charactersDir);
      } catch {
        overlayListing = [];
      }
    }
    return overlayListing;
  }

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
    sceneCuts: [],
    files: [],
    settings: {},
  };

  for (const ch of manifest.characters || []) {
    const entry = { ...ch };
    const cid = characterIdOf(ch);
    const defaultAvatarPath = `${charactersDir}/${cid}.png`;
    const fallbackAvatarPath = String(ch.avatarPath || defaultAvatarPath).trim();
    const fallbackImagePaths = Array.isArray(ch.imagePaths)
      ? ch.imagePaths.map((p) => String(p || '').trim()).filter(Boolean)
      : [];

    let avatarDataUrl = '';
    if (ch.avatarPath) {
      avatarDataUrl = await tryFetchPngAsDataUrl(ch.avatarPath);
    }
    if (!avatarDataUrl) {
      avatarDataUrl = await tryFetchPngAsDataUrl(defaultAvatarPath);
    }
    if (avatarDataUrl) entry.avatarDataUrl = avatarDataUrl;
    // data URL 변환 실패해도 정적 경로를 남겨 TTS/카드가 사진을 쓸 수 있게 한다
    entry.avatarPath = fallbackAvatarPath;

    const images = [];
    if (fallbackImagePaths.length) {
      for (const p of fallbackImagePaths) {
        const url = await tryFetchPngAsDataUrl(p);
        if (url) images.push(url);
      }
    } else {
      const listing = await listCharacterOverlays();
      const galleryRe = new RegExp(`^${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)\\.png$`, 'i');
      const galleryFiles = listing
        .filter((f) => f.type === 'file' && galleryRe.test(f.name))
        .sort((a, b) => {
          const na = Number(a.name.match(galleryRe)?.[1] || 0);
          const nb = Number(b.name.match(galleryRe)?.[1] || 0);
          return na - nb;
        });
      for (const f of galleryFiles) {
        const url = await tryFetchPngAsDataUrl(f.path);
        if (url) images.push(url);
      }
      if (!fallbackImagePaths.length) {
        entry.imagePaths = galleryFiles.map((f) => f.path);
      }
    }
    if (images.length) entry.images = images;
    else if (fallbackImagePaths.length) entry.imagePaths = fallbackImagePaths;

    payload.characters.push(entry);
  }

  for (const sceneCut of manifest.sceneCuts || []) {
    const entry = { ...sceneCut };
    const sceneCutId = sceneCut.sceneCutId
      || String(sceneCut.id || '').split('-').filter(Boolean).pop()
      || 'SCN0000';
    const defaultImagePath = `${overlayRoot}/scene-cuts/${sceneCutId}.png`;
    const imagePath = String(sceneCut.imagePath || defaultImagePath).trim();
    const image = await tryFetchImageAsDataUrl(
      imagePath,
      String(sceneCut.imageMime || 'image/png')
    );

    entry.imagePath = imagePath;
    entry.image = image || String(sceneCut.image || '').trim();
    payload.sceneCuts.push(entry);
  }

  for (const f of manifest.files || []) {
    let content = f.content || '';
    if (f.contentPath) {
      try {
        content = await getRepoFileText(f.contentPath);
      } catch {
        content = '';
      }
    }
    const next = { ...f, content };
    delete next.contentPath;
    payload.files.push(next);
  }

  const wp = manifest.settings?.canvasWallpaper;
  if (wp?.dataPath) {
    const dataUrl = await tryFetchPngAsDataUrl(wp.dataPath);
    payload.settings = {
      canvasWallpaper: {
        ...wp,
        dataUrl: dataUrl || wp.dataUrl || '',
        dataPath: undefined,
      },
    };
  } else if (manifest.settings) {
    payload.settings = manifest.settings;
  }

  return payload;
}

/** split 스냅샷 JSON이면 GitHub overlay에서 이미지를 채운 뒤 foreshadow-backup JSON 문자열 반환 */
export async function hydrateSplitBackupJson(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return jsonText;
  }
  if (!isGithubSplitManifest(data)) return jsonText;
  const full = await hydrateManifestFromGithub(data);
  return JSON.stringify(full, null, 2);
}
