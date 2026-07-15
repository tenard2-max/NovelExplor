/** GitHub split 스냅샷 → 경량 foreshadow-backup (자산 경로만 보존) */

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

/**
 * split manifest → 경량 foreshadow-backup payload.
 *
 * 프로젝트 열기에서는 JSON 메타데이터만 변환한다. PNG·MD/TXT를 Contents API로
 * 가져오지 않으며, 화면/백그라운드 캐시가 나중에 사용할 저장소 경로를 보존한다.
 * manifest에 data URL/본문이 직접 포함된 레거시 데이터는 그대로 유지한다.
 */
export async function hydrateManifestFromGithub(manifest) {
  const cfg = getGithubConfig();
  const overlayRoot = overlaysDir(cfg);
  const charactersDir = `${overlayRoot}/characters`;

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
    entry.avatarPath = String(ch.avatarPath || defaultAvatarPath).trim();
    entry.imagePaths = Array.isArray(ch.imagePaths)
      ? ch.imagePaths.map((p) => String(p || '').trim()).filter(Boolean)
      : [];
    payload.characters.push(entry);
  }

  for (const sceneCut of manifest.sceneCuts || []) {
    const entry = { ...sceneCut };
    const sceneCutId = sceneCut.sceneCutId
      || String(sceneCut.id || '').split('-').filter(Boolean).pop()
      || 'SCN0000';
    const defaultImagePath = `${overlayRoot}/scene-cuts/${sceneCutId}.png`;
    entry.imagePath = String(sceneCut.imagePath || defaultImagePath).trim();
    entry.image = String(sceneCut.image || '').trim();
    payload.sceneCuts.push(entry);
  }

  for (const f of manifest.files || []) {
    payload.files.push({
      ...f,
      content: String(f.content || ''),
      contentPath: String(f.contentPath || '').trim(),
    });
  }

  if (manifest.settings) {
    payload.settings = manifest.settings;
  }

  return payload;
}

/** split 스냅샷 JSON이면 자산 경로를 보존한 경량 백업 JSON 문자열 반환 */
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
