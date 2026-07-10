/** 프로젝트 관리 */



import * as storage from './storage.js';

import { uuid, nowIso, padEpisode, padStory, extractDocTitle, extractStoryReaderTitle, classifyImportFilename, isSettingMdPath, parseSettingMdIndex, basename } from './utils.js';

import { createSeedProject } from '../seed/seed-data.js';

import { emit } from './events.js';

import {

  createEpisodeFromStory,

  createEpisodeFileRecord,

  createStoryFileRecord,

  ensureEpisodesFromStories,
  syncStoriesFromFiles,
} from './story-episode.js';



let currentProject = null;

let cache = {

  stories: [],

  episodes: [],

  characters: [],

  worlds: [],

  foreshadows: [],

  timeline: [],

  files: [],

  characterRelations: [],

};



export function getCurrentProject() {

  return currentProject;

}



export function getCache() {

  return cache;

}



export async function listProjects() {

  return storage.getAll('projects');

}



export async function createProject(title = '새 프로젝트', useSeed = true) {

  const projectId = uuid();

  const seed = useSeed ? createSeedProject(projectId) : emptyProject(projectId, title);



  await storage.put('projects', seed.project);

  await saveAllEntities(projectId, seed);

  await loadProject(projectId);

  emit('project:loaded', currentProject);

  return currentProject;

}



function emptyProject(projectId, title) {

  return {

    project: {

      id: projectId,

      projectId,

      title,

      author: '',

      createdAt: nowIso(),

      updatedAt: nowIso(),

      version: '1.0.0',

      workspace: 'NovelMD',

      language: 'ko',

      versionMeta: { major: 1, minor: 0, patch: 0, build: 1 },

    },

    stories: [],

    episodes: [],

    characters: [],

    worlds: [],

    foreshadows: [],

    timeline: [],

    files: {},

  };

}



function buildStoryRecord(projectId, ep) {
  const textFile = `${padStory(ep.num)}.md`;
  const content = ep.body.replace(/^(#\s*)EP(\d+)/i, `$1ST$2`);
  return {
    id: `${projectId}-st-${ep.num}`,
    projectId,
    storyId: `${projectId}-st-${ep.num}`,
    title: ep.title,
    number: ep.num,
    textFile,
    content,
    originalContent: content,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}



function buildEpisodeRecord(projectId, ep) {

  const textFile = `${padEpisode(ep.num)}.md`;

  return {

    id: `${projectId}-ep-${ep.num}`,

    projectId,

    episodeId: `${projectId}-ep-${ep.num}`,

    title: ep.title,

    number: ep.num,

    summary: '',

    textFile,

    content: ep.body,

    originalContent: ep.body,

    sourceStoryId: `${projectId}-st-${ep.num}`,

    createdAt: nowIso(),

    updatedAt: nowIso(),

  };

}



async function saveAllEntities(projectId, seed) {
  // 소설(ST)은 파일 업로드로만 등록 — 시드 EP에서 자동 생성하지 않음
  const storyRecords = seed.stories
    ? seed.stories.map((s) => ({
      id: `${projectId}-st-${s.num}`,
      projectId,
      storyId: `${projectId}-st-${s.num}`,
      title: s.title,
      number: s.num,
      textFile: `${padStory(s.num)}.md`,
      content: s.body,
      originalContent: s.body,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }))
    : [];

  const episodeRecords = seed.episodes.map((ep) => buildEpisodeRecord(projectId, ep));



  const fileRecords = Object.entries(seed.files || {}).map(([path, content]) => ({

    id: `${projectId}-file-${path}`,

    projectId,

    path,

    folder: 'NovelMD',

    content,

    readonly: path.startsWith('Story/Original'),

    updatedAt: nowIso(),

  }));



  for (const story of storyRecords) {

    fileRecords.push(createStoryFileRecord(story, projectId));

  }

  for (const ep of episodeRecords) {

    fileRecords.push(createEpisodeFileRecord(ep, projectId));

  }



  await storage.bulkPut('stories', storyRecords);

  await storage.bulkPut('episodes', episodeRecords);

  await storage.bulkPut('characters', seed.characters.map((c) => ({ ...c, id: `${projectId}-${c.characterId}`, projectId })));

  await storage.bulkPut('worlds', seed.worlds.map((w) => ({ ...w, id: `${projectId}-${w.worldId}`, projectId })));

  await storage.bulkPut('foreshadows', seed.foreshadows.map((f) => ({ ...f, id: `${projectId}-${f.foreshadowId}`, projectId })));

  await storage.bulkPut('timeline', seed.timeline.map((t) => ({ ...t, id: `${projectId}-${t.eventId}`, projectId })));

  await storage.bulkPut('files', fileRecords);

}



export async function loadProject(projectId) {

  const project = await storage.get('projects', projectId);

  if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');



  currentProject = project;

  cache = {

    stories: (await storage.getByProject('stories', projectId)).sort((a, b) => a.number - b.number),

    episodes: (await storage.getByProject('episodes', projectId)).sort((a, b) => a.number - b.number),

    characters: await storage.getByProject('characters', projectId),

    worlds: await storage.getByProject('worlds', projectId),

    foreshadows: await storage.getByProject('foreshadows', projectId),

    timeline: (await storage.getByProject('timeline', projectId)).sort((a, b) => a.episode - b.episode),

    files: await storage.getByProject('files', projectId),

    characterRelations: (await storage.get('settings', `${projectId}-character-relations`))?.edges || [],

  };



  if (syncStoriesFromFiles(cache, projectId)) {
    await storage.bulkPut('stories', cache.stories);
  }

  await ensureEpisodesFromStories(cache, projectId);

  emit('project:loaded', currentProject);

  return currentProject;

}



export { ensureEpisodesFromStories };



export async function saveProjectFull() {
  if (!currentProject) throw new Error('열린 프로젝트가 없습니다.');

  const ts = nowIso();
  currentProject.updatedAt = ts;
  currentProject.versionMeta.patch += 1;

  const touch = (items) => items.map((item) => ({ ...item, updatedAt: item.updatedAt || ts }));

  await storage.put('projects', currentProject);
  if (cache.stories.length) await storage.bulkPut('stories', touch(cache.stories));
  if (cache.episodes.length) await storage.bulkPut('episodes', touch(cache.episodes));
  if (cache.characters.length) await storage.bulkPut('characters', touch(cache.characters));
  if (cache.worlds.length) await storage.bulkPut('worlds', touch(cache.worlds));
  if (cache.foreshadows.length) await storage.bulkPut('foreshadows', touch(cache.foreshadows));
  if (cache.timeline.length) await storage.bulkPut('timeline', touch(cache.timeline));
  if (cache.files.length) await storage.bulkPut('files', touch(cache.files));

  emit('project:saved', currentProject);
  return currentProject;
}

export async function saveProject() {
  return saveProjectFull();
}



export async function updateEpisode(episodeId, content) {

  const ep = cache.episodes.find((e) => e.id === episodeId);

  if (!ep) return;

  ep.content = content;

  ep.updatedAt = nowIso();

  await storage.put('episodes', ep);



  const file = cache.files.find((f) => f.episodeId === episodeId);

  if (file) {

    file.content = content;

    file.updatedAt = nowIso();

    await storage.put('files', file);

  }

}



export async function updateStory(storyId, content) {

  const story = cache.stories.find((s) => s.id === storyId);

  if (!story) return;

  story.content = content;

  story.updatedAt = nowIso();

  await storage.put('stories', story);



  const path = `Story/Original/${story.textFile}`;

  const file = cache.files.find((f) => f.path === path || f.storyId === storyId);

  if (file) {

    file.content = content;

    file.updatedAt = nowIso();

    await storage.put('files', file);

  }

}



export async function updateFile(fileId, content) {

  const file = cache.files.find((f) => f.id === fileId);

  if (!file) return;

  file.content = content;

  file.updatedAt = nowIso();

  await storage.put('files', file);

}



function nextStoryNumber() {

  const nums = cache.stories.map((s) => s.number);

  return nums.length ? Math.max(...nums) + 1 : 1;

}



function nextEpisodeNumber() {

  const nums = cache.episodes.map((e) => e.number);

  return nums.length ? Math.max(...nums) + 1 : 1;

}



/** 00_*.md — 세계관 설정 문서 업로드 */
export async function importSettingMdFile(text, filename) {
  const proj = getCurrentProject();
  if (!proj) throw new Error('프로젝트가 없습니다.');

  const path = basename(filename);
  if (!isSettingMdPath(path)) {
    throw new Error('세계관 설정 문서는 00_NAME.md 형식(2자리 숫자+_)이어야 합니다.');
  }

  const fileId = `${proj.projectId}-file-${path}`;
  const record = {
    id: fileId,
    projectId: proj.projectId,
    path,
    folder: 'NovelMD',
    docType: 'setting',
    settingIndex: parseSettingMdIndex(path),
    content: text,
    readonly: false,
    updatedAt: nowIso(),
  };

  const idx = cache.files.findIndex((f) => f.path === path);
  if (idx >= 0) cache.files[idx] = { ...cache.files[idx], ...record };
  else cache.files.push(record);

  await storage.put('files', record);
  return record;
}

/** ST*.md / TXT — 소설 읽기용 업로드 */

export async function importStoryFile(text, filename, number = null) {

  const proj = getCurrentProject();

  if (!proj) throw new Error('프로젝트가 없습니다.');



  const classified = classifyImportFilename(filename);

  const num = number ?? classified.number ?? nextStoryNumber();

  const textFile = `${padStory(num)}.md`;

  const storyId = `${proj.projectId}-st-${num}`;

  const title = extractStoryReaderTitle(text, filename.replace(/\.[^.]+$/, ''));

  const existingIdx = cache.stories.findIndex((s) => s.number === num);

  const record = {

    id: storyId,

    projectId: proj.projectId,

    storyId,

    title,

    number: num,

    textFile,

    content: text,

    originalContent: text,

    createdAt: existingIdx >= 0 ? cache.stories[existingIdx].createdAt : nowIso(),

    updatedAt: nowIso(),

  };



  if (existingIdx >= 0) cache.stories[existingIdx] = record;

  else cache.stories.push(record);

  cache.stories.sort((a, b) => a.number - b.number);



  await storage.put('stories', record);



  const fileRec = createStoryFileRecord(record, proj.projectId);

  const fileIdx = cache.files.findIndex((f) => f.path === fileRec.path);

  if (fileIdx >= 0) cache.files[fileIdx] = fileRec;

  else cache.files.push(fileRec);

  await storage.put('files', fileRec);



  await ensureEpisodesFromStories(cache, proj.projectId);

  return record;

}



/** EP*.md — 스토리 네비게이터용 업로드 */

export async function importEpisodeFile(text, filename, number = null) {

  const proj = getCurrentProject();

  if (!proj) throw new Error('프로젝트가 없습니다.');



  const classified = classifyImportFilename(filename);

  const num = number ?? classified.number ?? nextEpisodeNumber();

  const textFile = `${padEpisode(num)}.md`;

  const epId = `${proj.projectId}-ep-${num}`;

  const title = extractDocTitle(text, filename.replace(/\.[^.]+$/, ''));

  const story = cache.stories.find((s) => s.number === num);



  const existingIdx = cache.episodes.findIndex((e) => e.number === num);

  const record = {

    id: epId,

    projectId: proj.projectId,

    episodeId: epId,

    title,

    number: num,

    summary: '',

    textFile,

    content: text,

    originalContent: text,

    sourceStoryId: story?.id || null,

    createdAt: existingIdx >= 0 ? cache.episodes[existingIdx].createdAt : nowIso(),

    updatedAt: nowIso(),

  };



  if (existingIdx >= 0) cache.episodes[existingIdx] = record;

  else cache.episodes.push(record);

  cache.episodes.sort((a, b) => a.number - b.number);



  await storage.put('episodes', record);



  const fileRec = createEpisodeFileRecord(record, proj.projectId);

  const fileIdx = cache.files.findIndex((f) => f.path === fileRec.path);

  if (fileIdx >= 0) cache.files[fileIdx] = fileRec;

  else cache.files.push(fileRec);

  await storage.put('files', fileRec);



  return record;

}



export async function updateForeshadow(foreshadow) {

  const idx = cache.foreshadows.findIndex((f) => f.id === foreshadow.id);

  if (idx >= 0) cache.foreshadows[idx] = foreshadow;

  await storage.put('foreshadows', foreshadow);

  emit('foreshadow:updated', foreshadow);

}



export async function updateCharacter(character) {

  const idx = cache.characters.findIndex((c) => c.id === character.id);

  if (idx >= 0) cache.characters[idx] = character;

  await storage.put('characters', character);

  emit('character:updated', character);

}

/** XML CHR id / 이름으로 IndexedDB 인물 조회 */
export function findCharacterByXmlRef(xmlId, name = '') {
  const chars = cache.characters || [];
  if (xmlId) {
    const byId = chars.find(
      (c) => c.characterId === xmlId
        || c.id === xmlId
        || String(c.id).endsWith(`-${xmlId}`)
    );
    if (byId) return byId;
  }
  if (name) {
    return chars.find((c) => c.name === name) || null;
  }
  return null;
}

/**
 * 섹션 XML 인물 클릭 시 IndexedDB 레코드를 보장한다 (PNG 등록 패널용).
 * 없으면 characterId를 유지한 채 생성한다.
 */
export async function ensureCharacterFromXml(xmlChar) {
  if (!xmlChar?.id && !xmlChar?.name) return null;

  const existing = findCharacterByXmlRef(xmlChar.id, xmlChar.name);
  if (existing) {
    // XML 메타가 더 최신이면 비어 있는 필드만 보강
    const patched = {
      ...existing,
      name: existing.name || xmlChar.name || '',
      race: existing.race || xmlChar.race || '',
      gender: existing.gender || xmlChar.gender || '',
      age: existing.age || Number(xmlChar.age) || 0,
      occupation: existing.occupation || xmlChar.occupation || '',
      description: existing.description || xmlChar.description || '',
      firstEpisode: existing.firstEpisode || Number(xmlChar.firstEpisode) || 0,
      lastEpisode: existing.lastEpisode || Number(xmlChar.lastEpisode) || 0,
      status: existing.status || xmlChar.status || 'Alive',
      updatedAt: nowIso(),
    };
    const changed = JSON.stringify(patched) !== JSON.stringify(existing);
    if (changed) await updateCharacter(patched);
    return findCharacterByXmlRef(xmlChar.id, xmlChar.name);
  }

  const proj = getCurrentProject();
  if (!proj) return null;

  const characterId = xmlChar.id || `CHR${String((cache.characters?.length || 0) + 1).padStart(4, '0')}`;
  const record = {
    id: `${proj.projectId}-${characterId}`,
    projectId: proj.projectId,
    characterId,
    name: xmlChar.name || characterId,
    alias: [],
    race: xmlChar.race || '',
    gender: xmlChar.gender || '',
    age: Number(xmlChar.age) || 0,
    occupation: xmlChar.occupation || '',
    description: xmlChar.description || '',
    ability: [],
    firstEpisode: Number(xmlChar.firstEpisode) || 0,
    lastEpisode: Number(xmlChar.lastEpisode) || 0,
    status: xmlChar.status || 'Alive',
    images: [],
    avatarDataUrl: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  cache.characters.push(record);
  await storage.put('characters', record);
  emit('character:updated', record);
  return record;
}

// 새 인물을 생성해 저장한다. characterId는 CHR#### 형식으로 자동 증가.
export async function addCharacter(data = {}) {
  const proj = getCurrentProject();
  if (!proj || !data.name) return null;

  const nums = cache.characters
    .map((c) => parseInt(String(c.characterId || '').replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const characterId = `CHR${String(next).padStart(4, '0')}`;

  const record = {
    id: `${proj.projectId}-${characterId}`,
    projectId: proj.projectId,
    characterId,
    name: data.name,
    alias: data.alias || [],
    race: data.race || '',
    gender: data.gender || '',
    age: data.age || 0,
    occupation: data.occupation || '',
    description: data.description || '',
    ability: data.ability || [],
    firstEpisode: data.firstEpisode || 0,
    lastEpisode: data.lastEpisode || 0,
    status: data.status || 'Alive',
    images: [],
    avatarDataUrl: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  cache.characters.push(record);
  await storage.put('characters', record);
  emit('character:updated', record);
  return record;
}

// 인물을 DB와 캐시에서 삭제하고, 관련 수동 관계도 정리한다.
export async function deleteCharacter(characterId) {
  const idx = cache.characters.findIndex((c) => c.id === characterId);
  if (idx < 0) return false;

  await storage.remove('characters', characterId);
  cache.characters.splice(idx, 1);

  if (cache.characterRelations?.length) {
    const before = cache.characterRelations.length;
    cache.characterRelations = cache.characterRelations.filter(
      (e) => e.fromId !== characterId && e.toId !== characterId
    );
    if (cache.characterRelations.length !== before) {
      const proj = getCurrentProject();
      if (proj) {
        await storage.put('settings', {
          id: `${proj.projectId}-character-relations`,
          projectId: proj.projectId,
          edges: cache.characterRelations,
          updatedAt: nowIso(),
        });
      }
    }
  }

  emit('character:deleted', { id: characterId });
  return true;
}

function relationPairKey(fromId, toId) {
  return fromId < toId ? `${fromId}|${toId}` : `${toId}|${fromId}`;
}

export async function addCharacterRelation(fromId, toId) {
  const proj = getCurrentProject();
  if (!proj || !fromId || !toId || fromId === toId) return false;

  const key = relationPairKey(fromId, toId);
  if (!cache.characterRelations) cache.characterRelations = [];
  if (cache.characterRelations.some((e) => relationPairKey(e.fromId, e.toId) === key)) {
    return false;
  }

  cache.characterRelations.push({ fromId, toId, manual: true });
  await storage.put('settings', {
    id: `${proj.projectId}-character-relations`,
    projectId: proj.projectId,
    edges: cache.characterRelations,
    updatedAt: nowIso(),
  });
  return true;
}

export async function updateCharacterAvatar(characterId, avatarDataUrl) {
  const ch = cache.characters.find((c) => c.id === characterId);
  if (!ch) return null;
  const updated = { ...ch, avatarDataUrl: avatarDataUrl || '', updatedAt: nowIso() };
  await updateCharacter(updated);
  return updated;
}

// 대표 이미지(avatarDataUrl)와 이미지 갤러리(images)의 정합성을 맞춘다.
// - images가 비어 있고 대표만 있으면 images에 대표를 포함시킨다.
// - 대표가 비어 있고 images가 있으면 첫 이미지를 대표로 지정한다.
export async function ensureCharacterImages(characterId) {
  const ch = cache.characters.find((c) => c.id === characterId);
  if (!ch) return null;

  const images = Array.isArray(ch.images) ? [...ch.images] : [];
  let avatarDataUrl = ch.avatarDataUrl || '';
  let changed = false;

  if (avatarDataUrl && !images.includes(avatarDataUrl)) {
    images.unshift(avatarDataUrl);
    changed = true;
  }
  if (!avatarDataUrl && images.length) {
    avatarDataUrl = images[0];
    changed = true;
  }
  if (!Array.isArray(ch.images)) changed = true;

  if (!changed) return ch;
  const updated = { ...ch, images, avatarDataUrl, updatedAt: nowIso() };
  await updateCharacter(updated);
  return updated;
}

// 이미지 여러 장을 갤러리에 추가한다. 대표가 없으면(또는 makeRepresentative)
// 마지막으로 추가한 이미지를 대표로 지정한다.
export async function addCharacterImages(characterId, dataUrls, { makeRepresentative = false } = {}) {
  const ch = cache.characters.find((c) => c.id === characterId);
  if (!ch || !dataUrls?.length) return null;

  const images = Array.isArray(ch.images) ? [...ch.images] : [];
  images.push(...dataUrls);

  let avatarDataUrl = ch.avatarDataUrl || '';
  if (makeRepresentative || !avatarDataUrl) {
    avatarDataUrl = dataUrls[dataUrls.length - 1];
  }

  const updated = { ...ch, images, avatarDataUrl, updatedAt: nowIso() };
  await updateCharacter(updated);
  return updated;
}

// 갤러리에서 index 이미지를 삭제한다. 대표가 삭제되면 남은 첫 이미지를 대표로 승격.
export async function removeCharacterImage(characterId, index) {
  const ch = cache.characters.find((c) => c.id === characterId);
  if (!ch || !Array.isArray(ch.images) || index < 0 || index >= ch.images.length) return null;

  const removed = ch.images[index];
  const images = ch.images.filter((_, i) => i !== index);
  let avatarDataUrl = ch.avatarDataUrl || '';
  if (removed && removed === avatarDataUrl) {
    avatarDataUrl = images[0] || '';
  }

  const updated = { ...ch, images, avatarDataUrl, updatedAt: nowIso() };
  await updateCharacter(updated);
  return updated;
}

// 갤러리의 특정 이미지를 대표 이미지로 지정한다(관계도와 공유).
export async function setCharacterRepresentative(characterId, dataUrl) {
  const ch = cache.characters.find((c) => c.id === characterId);
  if (!ch) return null;
  const updated = { ...ch, avatarDataUrl: dataUrl || '', updatedAt: nowIso() };
  await updateCharacter(updated);
  return updated;
}



export async function exportProjectJson() {

  if (!currentProject) return null;

  const wallpaper = await storage.get('settings', `${currentProject.projectId}-canvas-wallpaper`);

  return JSON.stringify({

    format: 'foreshadow-backup',

    version: 1,

    project: currentProject,

    ...cache,

    settings: {

      canvasWallpaper: wallpaper || null,

    },

    exportedAt: nowIso(),

  }, null, 2);

}



export async function importProjectJson(jsonText) {

  const data = JSON.parse(jsonText);

  const projectId = uuid();

  const project = { ...data.project, id: projectId, projectId, createdAt: nowIso(), updatedAt: nowIso() };

  await storage.put('projects', project);



  const remap = (items, key) => (items || []).map((item) => ({

    ...item,

    id: `${projectId}-${item[key] || item.id}`,

    projectId,

  }));



  await storage.bulkPut('stories', remap(data.stories, 'storyId'));

  await storage.bulkPut('episodes', remap(data.episodes, 'episodeId'));

  await storage.bulkPut('characters', remap(data.characters, 'characterId'));

  await storage.bulkPut('worlds', remap(data.worlds, 'worldId'));

  await storage.bulkPut('foreshadows', remap(data.foreshadows, 'foreshadowId'));

  await storage.bulkPut('timeline', remap(data.timeline, 'eventId'));

  await storage.bulkPut('files', (data.files || []).map((f) => ({

    ...f,

    id: `${projectId}-file-${f.path}`,

    projectId,

  })));



  const oldToNewCharId = new Map();

  for (const ch of data.characters || []) {

    oldToNewCharId.set(ch.id, `${projectId}-${ch.characterId || ch.id}`);

  }



  const relations = (data.characterRelations || []).map((e) => ({

    ...e,

    fromId: oldToNewCharId.get(e.fromId) || e.fromId,

    toId: oldToNewCharId.get(e.toId) || e.toId,

  }));

  if (relations.length) {

    await storage.put('settings', {

      id: `${projectId}-character-relations`,

      projectId,

      edges: relations,

      updatedAt: nowIso(),

    });

  }



  const wallpaper = data.settings?.canvasWallpaper;

  if (wallpaper) {

    await storage.put('settings', {

      ...wallpaper,

      id: `${projectId}-canvas-wallpaper`,

      projectId,

    });

  }



  await loadProject(projectId);

  return currentProject;

}



export function getFileByPath(path) {

  return cache.files.find((f) => f.path === path);

}



export function getEpisodeByNumber(num) {

  return cache.episodes.find((e) => e.number === num);

}



export function getStoryByNumber(num) {
  return getRegisteredStories().find((s) => s.number === num);
}

/** 소설 읽기에 표시할 스토리 목록 (IndexedDB) */
export function getRegisteredStories() {
  return (cache.stories || [])
    .filter((s) => {
      if (s == null || s.number == null || Number.isNaN(Number(s.number))) return false;
      const tf = s.textFile || '';
      // ST###.md 이거나, 본문/제목이 있는 업로드 소설
      if (/^ST\d+\.md$/i.test(tf)) return true;
      if (/ST\d+/i.test(tf)) return true;
      return Boolean(s.content || s.title);
    })
    .sort((a, b) => a.number - b.number);
}

export async function deleteStory(number) {
  const story = cache.stories.find((s) => s.number === number);
  if (!story) return false;

  await storage.remove('stories', story.id);
  cache.stories = cache.stories.filter((s) => s.id !== story.id);

  const path = `Story/Original/${story.textFile}`;
  const file = cache.files.find(
    (f) => f.storyId === story.id || f.path === path || basename(f.path) === story.textFile
  );
  if (file) {
    await storage.remove('files', file.id);
    cache.files = cache.files.filter((f) => f.id !== file.id);
  }
  return true;
}

export async function deleteAllStories() {
  const nums = getRegisteredStories().map((s) => s.number);
  for (const num of nums) {
    await deleteStory(num);
  }
}


