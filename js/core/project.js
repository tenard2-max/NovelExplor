/** 프로젝트 관리 */



import * as storage from './storage.js';

import { uuid, nowIso, padEpisode, padStory, extractDocTitle, extractStoryReaderTitle, classifyImportFilename, isSettingMdPath, parseSettingMdIndex, basename } from './utils.js';

import { createSeedProject } from '../seed/seed-data.js';

import { emit } from './events.js';

import { dedupeTimelineByEpisode } from './story-sync-engine.js';

import {
  getCurrentUser,
  canCreateUnlimitedProjects,
  canSaveProject,
  canManageProjectContent,
  canBeProjectWriter,
  normalizeWriters,
  normalizeWriterNames,
  isMaster,
  listUsers,
  MAX_USER_PROJECTS,
} from './auth.js';

import {

  createEpisodeFromStory,

  createEpisodeFileRecord,

  createStoryFileRecord,

  ensureEpisodesFromStories,
  syncStoriesFromFiles,
} from './story-episode.js';



const LAST_OPENED_KEY = 'ne-last-opened-project-id';

let currentProject = null;

let cache = {

  stories: [],

  episodes: [],

  characters: [],

  sceneCuts: [],

  worlds: [],

  foreshadows: [],

  timeline: [],

  files: [],

  characterRelations: [],

};



export function getCurrentProject() {

  return currentProject;

}

/** 현재 열린 프로젝트 콘텐츠 관리 가능 (마스터=전체, writers 포함 시) */
export function canManageCurrentProject() {
  return canManageProjectContent(currentProject);
}

export function getCache() {

  return cache;

}



export async function listProjects() {
  const all = await storage.getAll('projects');
  const user = getCurrentUser();
  if (!user) return [];
  // 로그인 사용자: 브라우저 DB의 프로젝트 전부 열람 가능
  return all
    .map(ensureProjectAcl)
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
}

/** 마지막으로 연 프로젝트 ID (localStorage) */
export function getLastOpenedProjectId() {
  try {
    return localStorage.getItem(LAST_OPENED_KEY) || '';
  } catch {
    return '';
  }
}

export function rememberLastOpenedProject(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return;
  try {
    localStorage.setItem(LAST_OPENED_KEY, id);
  } catch {
    /* ignore */
  }
}

/** 부트 시 열 프로젝트: 마지막 열림 우선, 없으면 최근 수정순 */
export function resolveBootProjectId(projects = []) {
  if (!projects.length) return null;
  const lastId = getLastOpenedProjectId();
  if (lastId) {
    const found = projects.find((p) => p.id === lastId || p.projectId === lastId);
    if (found) return found.id || found.projectId;
  }
  return projects[0].id || projects[0].projectId;
}

/** 소유자 없는 기존 프로젝트를 현재 사용자(보통 마스터)에게 귀속 */
export async function claimOrphanProjects(userId) {
  if (!userId) return 0;
  const all = await storage.getAll('projects');
  let n = 0;
  for (const p of all) {
    if (p.ownerId) {
      ensureProjectAcl(p);
      if (!normalizeWriters(p.writers).length && p.ownerId) {
        p.writers = [p.ownerId];
        p.updatedAt = nowIso();
        await storage.put('projects', p);
      }
      continue;
    }
    p.ownerId = userId;
    p.writers = normalizeWriters(p.writers);
    if (!p.writers.length) p.writers = [userId];
    p.updatedAt = nowIso();
    await storage.put('projects', p);
    n += 1;
  }
  return n;
}

/** ownerId / writers / writerUsernames 정규화 */
export function ensureProjectAcl(project) {
  if (!project) return project;
  const writers = normalizeWriters(project.writers);
  const writerUsernames = normalizeWriterNames(project.writerUsernames);
  if (writers.length) {
    project.writers = writers;
  } else if (project.ownerId) {
    project.writers = [String(project.ownerId)];
  } else {
    project.writers = [];
  }
  project.writerUsernames = writerUsernames;
  return project;
}

/**
 * 마스터 전용: 현재 프로젝트의 쓰기 권한(writers) 설정
 * @param {string[]} writerIds 소설가·개발자 userId 목록
 */
export async function setProjectWriters(writerIds) {
  if (!currentProject) throw new Error('열린 프로젝트가 없습니다.');
  return setProjectWritersById(currentProject.id || currentProject.projectId, writerIds);
}

/** id 또는 projectId 로 프로젝트 레코드 조회 */
export async function findProjectRecord(projectId) {
  if (!projectId) return null;
  const direct = await storage.get('projects', projectId);
  if (direct) return direct;
  const all = await storage.getAll('projects');
  return all.find((p) => p.id === projectId || p.projectId === projectId) || null;
}

/**
 * 마스터 전용: 지정 프로젝트 writers 설정 (열지 않아도 IDB 갱신)
 * @param {string} projectId
 * @param {string[]} writerIds
 */
export async function setProjectWritersById(projectId, writerIds) {
  if (!isMaster()) throw new Error('마스터만 프로젝트 쓰기 권한을 부여할 수 있습니다.');
  if (!projectId) throw new Error('프로젝트가 없습니다.');

  const project = await findProjectRecord(projectId);
  if (!project) throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`);

  const users = await listUsers();
  const byId = new Map(users.map((u) => [u.id, u]));
  const allowed = normalizeWriters(writerIds)
    .map((id) => byId.get(id))
    .filter((u) => u && canBeProjectWriter(u));

  const key = project.id || project.projectId;
  project.writers = allowed.map((u) => u.id);
  project.writerUsernames = normalizeWriterNames(allowed.map((u) => u.username));
  if (!project.ownerId && project.writers[0]) project.ownerId = project.writers[0];
  project.updatedAt = nowIso();
  ensureProjectAcl(project);
  await storage.put('projects', project);

  if (currentProject && (
    currentProject.id === key || currentProject.projectId === key
    || currentProject.id === projectId || currentProject.projectId === projectId
  )) {
    currentProject.writers = [...project.writers];
    currentProject.writerUsernames = [...project.writerUsernames];
    currentProject.ownerId = project.ownerId;
    currentProject.updatedAt = project.updatedAt;
    emit('project:loaded', currentProject);
  }
  return project;
}

/**
 * 마스터: 특정 관리자의 쓰기 권한을 여러 로컬 프로젝트에 일괄 반영
 * @param {string} adminUserId
 * @param {string[]} grantProjectIds 권한 줄 프로젝트 id
 * @param {string[]} revokeProjectIds 권한 뺄 프로젝트 id
 * @returns {Promise<{ changed: number, projectIds: string[], errors: string[], granted: number, revoked: number }>}
 */
export async function applyAdminWriteAccess(adminUserId, grantProjectIds = [], revokeProjectIds = []) {
  if (!isMaster()) throw new Error('마스터만 프로젝트 쓰기 권한을 부여할 수 있습니다.');
  const users = await listUsers();
  const admin = users.find((u) => u.id === adminUserId);
  if (!admin || !canBeProjectWriter(admin)) {
    throw new Error('소설가·개발자만 쓰기 권한을 받을 수 있습니다.');
  }

  const adminName = String(admin.username || '').trim().toLowerCase();
  const grant = new Set(grantProjectIds.filter(Boolean));
  const revoke = new Set(revokeProjectIds.filter(Boolean));
  const touched = [];
  const errors = [];
  let granted = 0;
  let revoked = 0;

  for (const id of new Set([...grant, ...revoke])) {
    try {
      const project = await findProjectRecord(id);
      if (!project) {
        errors.push(`프로젝트를 찾을 수 없음: ${id}`);
        continue;
      }

      ensureProjectAcl(project);
      const writerSet = new Set(normalizeWriters(project.writers));
      const nameSet = new Set(normalizeWriterNames(project.writerUsernames));
      const before = `${[...writerSet].sort().join('|')}::${[...nameSet].sort().join('|')}`;

      if (grant.has(id)) {
        writerSet.add(adminUserId);
        if (adminName) nameSet.add(adminName);
      }
      if (revoke.has(id)) {
        writerSet.delete(adminUserId);
        if (adminName) nameSet.delete(adminName);
      }

      // 소설가·개발자만 writers 유지 (마스터 id는 역할로 이미 쓰기 가능)
      const nextUsers = [...writerSet]
        .map((wid) => users.find((u) => u.id === wid))
        .filter((u) => u && canBeProjectWriter(u));

      if (grant.has(id) && !nextUsers.some((u) => u.id === adminUserId)) {
        nextUsers.push(admin);
      }

      const key = project.id || project.projectId;
      project.writers = normalizeWriters(nextUsers.map((u) => u.id));
      project.writerUsernames = normalizeWriterNames([
        ...nextUsers.map((u) => u.username).filter(Boolean),
        ...(grant.has(id) && adminName ? [adminName] : []),
      ].filter((n) => !(revoke.has(id) && n === adminName)));

      if (grant.has(id)) {
        if (!project.writers.includes(adminUserId)) {
          project.writers = normalizeWriters([...project.writers, adminUserId]);
        }
        if (adminName && !project.writerUsernames.includes(adminName)) {
          project.writerUsernames = normalizeWriterNames([...project.writerUsernames, adminName]);
        }
      }

      project.updatedAt = nowIso();
      ensureProjectAcl(project);
      // ensure 가 writers 를 owner 로만 채운 뒤 grant 가 빠지지 않게 재확인
      if (grant.has(id)) {
        if (!project.writers.includes(adminUserId)) {
          project.writers = normalizeWriters([...project.writers, adminUserId]);
        }
        if (adminName && !normalizeWriterNames(project.writerUsernames).includes(adminName)) {
          project.writerUsernames = normalizeWriterNames([...project.writerUsernames, adminName]);
        }
      }

      await storage.put('projects', project);

      const verify = await findProjectRecord(key);
      if (!verify) {
        errors.push(`저장 후 재조회 실패: ${project.title || key}`);
        continue;
      }

      if (grant.has(id)) {
        const okId = normalizeWriters(verify.writers).includes(adminUserId);
        const okName = adminName && normalizeWriterNames(verify.writerUsernames).includes(adminName);
        if (!okId && !okName) {
          errors.push(`저장 검증 실패(권한 미반영): ${project.title || key}`);
          continue;
        }
        granted += 1;
      }
      if (revoke.has(id) && !grant.has(id)) {
        const stillId = normalizeWriters(verify.writers).includes(adminUserId);
        const stillName = adminName && normalizeWriterNames(verify.writerUsernames).includes(adminName);
        if (stillId || stillName) {
          errors.push(`해제 검증 실패: ${project.title || key}`);
        } else {
          revoked += 1;
        }
      }

      if (currentProject && (currentProject.id === key || currentProject.projectId === key)) {
        currentProject.writers = [...verify.writers];
        currentProject.writerUsernames = [...(verify.writerUsernames || [])];
        currentProject.updatedAt = verify.updatedAt;
      }

      const after = `${normalizeWriters(verify.writers).slice().sort().join('|')}::${normalizeWriterNames(verify.writerUsernames).slice().sort().join('|')}`;
      if (after !== before) touched.push(key);
    } catch (err) {
      errors.push(`${id}: ${err.message || err}`);
    }
  }

  if (currentProject && touched.some((id) => id === currentProject.id || id === currentProject.projectId)) {
    emit('project:loaded', currentProject);
  }

  return {
    changed: touched.length,
    projectIds: touched,
    errors,
    granted,
    revoked,
  };
}

export async function countOwnedProjects(userId) {
  const all = await storage.getAll('projects');
  return all.filter((p) => p.ownerId === userId).length;
}

/** JSON 복원 전 — 마스터는 전체, 그 외는 본인·무소유 프로젝트만 삭제 */
export async function clearAllProjects() {
  const user = getCurrentUser();
  const projects = await storage.getAll('projects');
  const targets = !user
    ? projects
    : isMaster(user)
      ? projects
      : projects.filter((p) => p.ownerId === user.id || !p.ownerId);
  const projectIds = new Set(targets.map((p) => p.id || p.projectId).filter(Boolean));

  const entityStores = ['stories', 'episodes', 'characters', 'sceneCuts', 'worlds', 'foreshadows', 'timeline', 'files'];
  for (const store of entityStores) {
    const all = await storage.getAll(store);
    for (const rec of all) {
      if (projectIds.has(rec.projectId)) {
        await storage.remove(store, rec.id);
      }
    }
  }

  const settings = await storage.getAll('settings');
  for (const rec of settings) {
    if (rec.projectId && projectIds.has(rec.projectId)) {
      await storage.remove('settings', rec.id);
    }
  }

  for (const p of targets) {
    await storage.remove('projects', p.id);
  }

  currentProject = null;
  cache = {
    stories: [],
    episodes: [],
    characters: [],
    sceneCuts: [],
    worlds: [],
    foreshadows: [],
    timeline: [],
    files: [],
    characterRelations: [],
  };
}

/** 백업 JSON 인물 중 사진(대표·갤러리)이 있는 수 */
export function countCharactersWithPhotos(characters = []) {
  return characters.filter((ch) => characterHasPhoto(ch)).length;
}

export function characterHasPhoto(ch) {
  if (!ch) return false;
  if (String(ch.avatarPath || '').trim()) return true;
  const avatar = String(ch.avatarDataUrl || ch.image || ch.avatar || ch.avatarUrl || ch.photo || '').trim();
  if (avatar) return true;
  if (Array.isArray(ch.images) && ch.images.some((u) => String(u || '').trim())) return true;
  if (Array.isArray(ch.photos) && ch.photos.some((u) => String(u || '').trim())) return true;
  return false;
}



export async function createProject(title = '새 프로젝트', useSeed = true) {
  const user = getCurrentUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!canSaveProject(user)) {
    throw new Error('일반 사용자는 프로젝트를 만들 수 없습니다. 프로젝트 열기만 가능합니다.');
  }

  if (!canCreateUnlimitedProjects(user)) {
    const owned = await countOwnedProjects(user.id);
    if (owned >= MAX_USER_PROJECTS) {
      throw new Error(`일반 사용자는 프로젝트를 최대 ${MAX_USER_PROJECTS}개까지 만들 수 있습니다.`);
    }
  }

  const projectId = uuid();
  // useSeed=false(메뉴「새 프로젝트」): 스토리·인물·떡밥·네비 전부 빈 상태
  // useSeed=true(최초 부트 등): 데모 시드 — 기존 프로젝트 IDB는 건드리지 않음
  const seed = useSeed ? createSeedProject(projectId) : emptyProject(projectId, title);
  seed.project.ownerId = user.id;
  seed.project.author = user.username;
  seed.project.writers = [user.id];
  seed.project.writerUsernames = user.username
    ? [String(user.username).toLowerCase()]
    : [];
  if (!useSeed) {
    seed.project.title = title || '새 프로젝트';
  }

  // 화면 캐시만 비움 — 다른 프로젝트 IndexedDB 레코드는 유지
  currentProject = null;
  cache = {
    stories: [],
    episodes: [],
    characters: [],
    sceneCuts: [],
    worlds: [],
    foreshadows: [],
    timeline: [],
    files: [],
    characterRelations: [],
  };
  emit('project:cleared');

  await storage.put('projects', seed.project);
  await saveAllEntities(projectId, seed);
  // 새 프로젝트 전용 관계도 슬롯 명시적 초기화
  await storage.put('settings', {
    id: `${projectId}-character-relations`,
    projectId,
    edges: [],
  });
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

      ownerId: '',

      writers: [],

      writerUsernames: [],

      versionMeta: { major: 1, minor: 0, patch: 0, build: 1 },

    },

    stories: [],

    episodes: [],

    characters: [],

    sceneCuts: [],

    worlds: [],

    foreshadows: [],

    timeline: [],

    files: {},

    characterRelations: [],

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

  await storage.bulkPut('sceneCuts', (seed.sceneCuts || []).map((sceneCut) => ({
    ...sceneCut,
    id: `${projectId}-${sceneCut.sceneCutId}`,
    projectId,
  })));

  await storage.bulkPut('worlds', seed.worlds.map((w) => ({ ...w, id: `${projectId}-${w.worldId}`, projectId })));

  await storage.bulkPut('foreshadows', seed.foreshadows.map((f) => ({ ...f, id: `${projectId}-${f.foreshadowId}`, projectId })));

  await storage.bulkPut('timeline', seed.timeline.map((t) => ({ ...t, id: `${projectId}-${t.eventId}`, projectId })));

  await storage.bulkPut('files', fileRecords);

}



export async function loadProject(projectId) {

  const project = await storage.get('projects', projectId);

  if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');



  currentProject = ensureProjectAcl(project);

  cache = {

    stories: (await storage.getByProject('stories', projectId)).sort((a, b) => a.number - b.number),

    episodes: (await storage.getByProject('episodes', projectId)).sort((a, b) => a.number - b.number),

    characters: await storage.getByProject('characters', projectId),

    sceneCuts: (await storage.getByProject('sceneCuts', projectId))
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))),

    worlds: await storage.getByProject('worlds', projectId),

    foreshadows: await storage.getByProject('foreshadows', projectId),

    timeline: (await storage.getByProject('timeline', projectId)).sort((a, b) => a.episode - b.episode),

    files: await storage.getByProject('files', projectId),

    characterRelations: (await storage.get('settings', `${projectId}-character-relations`))?.edges || [],

  };

  cache.characterRelations = (cache.characterRelations || []).map((rel) => normalizeCharacterRelation(rel));



  if (syncStoriesFromFiles(cache, projectId)) {
    await storage.bulkPut('stories', cache.stories);
  }

  await ensureEpisodesFromStories(cache, projectId);

  rememberLastOpenedProject(currentProject.id || currentProject.projectId || projectId);
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
  if (cache.sceneCuts.length) await storage.bulkPut('sceneCuts', touch(cache.sceneCuts));
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

/** 장면컷 생성 — 이름·설명·이미지를 프로젝트별 IndexedDB에 저장 */
export async function addSceneCut(data = {}) {
  const proj = getCurrentProject();
  const name = String(data.name || '').trim();
  if (!proj || !name) return null;
  if (findSceneCutByName(name)) return null;

  const nums = (cache.sceneCuts || [])
    .map((item) => parseInt(String(item.sceneCutId || '').replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const sceneCutId = `SCN${String(next).padStart(4, '0')}`;
  const timestamp = nowIso();
  const record = {
    id: `${proj.projectId}-${sceneCutId}`,
    projectId: proj.projectId,
    sceneCutId,
    name,
    description: String(data.description || '').trim(),
    image: String(data.image || '').trim(),
    imagePath: String(data.imagePath || '').trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  cache.sceneCuts.push(record);
  await storage.put('sceneCuts', record);
  emit('scene-cut:created', record);
  return record;
}

/** 장면컷 이름·설명·이미지 수정 */
export async function updateSceneCut(sceneCut) {
  if (!sceneCut?.id) return null;
  const idx = cache.sceneCuts.findIndex((item) => item.id === sceneCut.id);
  if (idx < 0) return null;

  const merged = { ...cache.sceneCuts[idx], ...sceneCut };
  const updated = {
    ...merged,
    name: String(merged.name || '').trim(),
    description: String(merged.description || '').trim(),
    image: String(merged.image || '').trim(),
    imagePath: String(merged.imagePath || '').trim(),
    updatedAt: nowIso(),
  };
  if (!updated.name) return null;
  const duplicate = cache.sceneCuts.find(
    (item) => item.id !== updated.id
      && String(item.name || '').trim().toLocaleLowerCase('ko')
        === updated.name.toLocaleLowerCase('ko')
  );
  if (duplicate) return null;

  cache.sceneCuts[idx] = updated;
  await storage.put('sceneCuts', updated);
  emit('scene-cut:updated', updated);
  return updated;
}

/** TTS 태그 등에서 사용할 장면컷 이름 정확 일치 검색 */
export function findSceneCutByName(name) {
  const target = String(name || '').trim().toLocaleLowerCase('ko');
  if (!target) return null;
  return cache.sceneCuts.find(
    (item) => String(item.name || '').trim().toLocaleLowerCase('ko') === target
  ) || null;
}

/** 장면컷 삭제 */
export async function deleteSceneCut(sceneCutId) {
  const idx = cache.sceneCuts.findIndex((item) => item.id === sceneCutId);
  if (idx < 0) return false;

  await storage.remove('sceneCuts', sceneCutId);
  const [removed] = cache.sceneCuts.splice(idx, 1);
  emit('scene-cut:deleted', removed);
  return true;
}

function relationPairKey(fromId, toId) {
  return fromId < toId ? `${fromId}|${toId}` : `${toId}|${fromId}`;
}

const RELATION_TYPES = {
  neutral: { label: '중립', color: '#ffffff' },
  ally: { label: '아군', color: '#93c5fd' },
  enemy: { label: '적군', color: '#f87171' },
};

const RELATION_DEFAULTS = {
  type: 'ally',
  lineWidth: 3,
  description: '',
};

export function getRelationTypeMeta(type) {
  return RELATION_TYPES[type] || RELATION_TYPES.ally;
}

export function normalizeCharacterRelation(rel = {}) {
  const type = RELATION_TYPES[rel.type] ? rel.type : RELATION_DEFAULTS.type;
  const lineWidth = Math.min(10, Math.max(1, Number(rel.lineWidth) || RELATION_DEFAULTS.lineWidth));
  const lineNo = Math.min(100, Math.max(1, Number(rel.lineNo) || 0));
  return {
    fromId: rel.fromId,
    toId: rel.toId,
    manual: !!rel.manual,
    lineNo: lineNo || 0,
    type,
    lineWidth,
    description: typeof rel.description === 'string' ? rel.description : '',
  };
}

async function persistCharacterRelations() {
  const proj = getCurrentProject();
  if (!proj) return false;
  await storage.put('settings', {
    id: `${proj.projectId}-character-relations`,
    projectId: proj.projectId,
    edges: cache.characterRelations || [],
    updatedAt: nowIso(),
  });
  return true;
}

function nextRelationLineNo(edges = cache.characterRelations || []) {
  const used = new Set(
    edges.map((e) => Number(e.lineNo)).filter((n) => n >= 1 && n <= 100)
  );
  for (let i = 1; i <= 100; i += 1) {
    if (!used.has(i)) return i;
  }
  return 0;
}

/** 자동/수동 관계선을 정규화하고, 번호가 없으면 등장 순서대로 1~100 부여 */
export async function ensureCharacterRelationsNormalized() {
  if (!cache.characterRelations) cache.characterRelations = [];
  let changed = false;
  const normalized = cache.characterRelations.map((rel) => {
    const next = normalizeCharacterRelation(rel);
    if (
      next.type !== rel.type
      || next.lineWidth !== rel.lineWidth
      || next.description !== (rel.description || '')
      || next.lineNo !== (rel.lineNo || 0)
    ) {
      changed = true;
    }
    return next;
  });

  for (const rel of normalized) {
    if (!rel.lineNo) {
      rel.lineNo = nextRelationLineNo(normalized);
      changed = true;
    }
  }

  cache.characterRelations = normalized;
  if (changed) await persistCharacterRelations();
  return cache.characterRelations;
}

/**
 * 자동 감지된 페어를 관계선으로 반영한다.
 * 이미 있으면 유지하고, 없으면 기본값(아군·두께3·설명빈칸)으로 추가한다.
 * @param {Array<[string, string]>} pairs - [idA, idB] 등장 순서
 */
export async function upsertAutoCharacterRelations(pairs = []) {
  if (!cache.characterRelations) cache.characterRelations = [];
  await ensureCharacterRelationsNormalized();

  let changed = false;
  for (const [idA, idB] of pairs) {
    if (!idA || !idB || idA === idB) continue;
    const key = relationPairKey(idA, idB);
    const exists = cache.characterRelations.some(
      (e) => relationPairKey(e.fromId, e.toId) === key
    );
    if (exists) continue;

    const lineNo = nextRelationLineNo();
    if (!lineNo) break;

    cache.characterRelations.push(normalizeCharacterRelation({
      fromId: idA,
      toId: idB,
      manual: false,
      lineNo,
      ...RELATION_DEFAULTS,
    }));
    changed = true;
  }

  if (changed) await persistCharacterRelations();
  return changed;
}

export async function addCharacterRelation(fromId, toId, options = {}) {
  const proj = getCurrentProject();
  if (!proj || !fromId || !toId || fromId === toId) return null;

  if (!cache.characterRelations) cache.characterRelations = [];
  await ensureCharacterRelationsNormalized();

  const key = relationPairKey(fromId, toId);
  const existing = cache.characterRelations.find(
    (e) => relationPairKey(e.fromId, e.toId) === key
  );
  if (existing) return existing;

  const lineNo = Number(options.lineNo) || nextRelationLineNo();
  if (!lineNo) return null;

  const record = normalizeCharacterRelation({
    fromId,
    toId,
    manual: options.manual !== false,
    lineNo,
    type: options.type || RELATION_DEFAULTS.type,
    lineWidth: options.lineWidth ?? RELATION_DEFAULTS.lineWidth,
    description: options.description ?? RELATION_DEFAULTS.description,
  });

  cache.characterRelations.push(record);
  await persistCharacterRelations();
  return record;
}

export async function updateCharacterRelation(fromId, toId, patch = {}) {
  if (!cache.characterRelations) return null;
  const key = relationPairKey(fromId, toId);
  const idx = cache.characterRelations.findIndex(
    (e) => relationPairKey(e.fromId, e.toId) === key
  );
  if (idx < 0) return null;

  const updated = normalizeCharacterRelation({
    ...cache.characterRelations[idx],
    ...patch,
    fromId: cache.characterRelations[idx].fromId,
    toId: cache.characterRelations[idx].toId,
  });

  // lineNo 중복 방지
  if (updated.lineNo) {
    const clash = cache.characterRelations.some(
      (e, i) => i !== idx && Number(e.lineNo) === updated.lineNo
    );
    if (clash) {
      updated.lineNo = cache.characterRelations[idx].lineNo || nextRelationLineNo();
    }
  }

  cache.characterRelations[idx] = updated;
  await persistCharacterRelations();
  return updated;
}

export async function removeCharacterRelation(fromId, toId) {
  if (!cache.characterRelations?.length) return false;
  const key = relationPairKey(fromId, toId);
  const before = cache.characterRelations.length;
  cache.characterRelations = cache.characterRelations.filter(
    (e) => relationPairKey(e.fromId, e.toId) !== key
  );
  if (cache.characterRelations.length === before) return false;
  await persistCharacterRelations();
  return true;
}

export async function getCharacterLayout() {
  const proj = getCurrentProject();
  if (!proj) return { positions: {} };
  const row = await storage.get('settings', `${proj.projectId}-character-layout`);
  return {
    positions: row?.positions && typeof row.positions === 'object' ? row.positions : {},
    updatedAt: row?.updatedAt || null,
  };
}

export async function saveCharacterLayout(positions = {}) {
  const proj = getCurrentProject();
  if (!proj) return false;
  await storage.put('settings', {
    id: `${proj.projectId}-character-layout`,
    projectId: proj.projectId,
    positions,
    updatedAt: nowIso(),
  });
  return true;
}

function nextTimelineEventId() {
  const nums = (cache.timeline || [])
    .map((t) => parseInt(String(t.eventId || '').replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `TL${String(next).padStart(4, '0')}`;
}

export async function addTimelineEvent(data = {}, opts = {}) {
  const proj = getCurrentProject();
  if (!proj) return null;

  const eventId = data.eventId || nextTimelineEventId();
  const record = {
    id: `${proj.projectId}-${eventId}`,
    projectId: proj.projectId,
    eventId,
    episode: Number(data.episode) || 0,
    date: data.date || '',
    title: data.title || '사건',
    description: data.description || '',
    characters: Array.isArray(data.characters) ? data.characters : [],
    foreshadows: Array.isArray(data.foreshadows) ? data.foreshadows : [],
    source: data.source || 'manual',
    keywords: Array.isArray(data.keywords) ? data.keywords : [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  cache.timeline.push(record);
  cache.timeline.sort((a, b) => (a.episode - b.episode) || String(a.eventId).localeCompare(String(b.eventId)));
  await storage.put('timeline', record);
  if (!opts.silent) emit('timeline:updated', record);
  return record;
}

/** 스토리 동기화로 만든 타임라인만 제거하고 새 후보로 교체 */
export async function replaceStorySyncTimeline(candidates = []) {
  const proj = getCurrentProject();
  if (!proj) return 0;

  const keep = [];
  for (const ev of cache.timeline || []) {
    if (ev.source === 'story-sync') {
      await storage.remove('timeline', ev.id);
    } else {
      keep.push(ev);
    }
  }
  cache.timeline = keep;

  let added = 0;
  const unique = dedupeTimelineByEpisode(candidates);
  for (const c of unique) {
    const rec = await addTimelineEvent({
      ...c,
      source: 'story-sync',
    }, { silent: true });
    if (rec) added += 1;
  }

  // EP 중복 잔여분 정리 (이전 다중 추출 데이터 포함)
  const collapsed = dedupeTimelineByEpisode(cache.timeline);
  const keepIds = new Set(collapsed.map((t) => t.id));
  for (const ev of [...(cache.timeline || [])]) {
    if (!keepIds.has(ev.id)) await storage.remove('timeline', ev.id);
  }
  cache.timeline = collapsed;

  emit('timeline:updated', { count: added, source: 'story-sync' });
  return added;
}

/** IndexedDB files 에 MD 문서 등록 (GitHub overlays/stories 로 동기화) */
export async function upsertWorkspaceMarkdown(path, markdown, meta = {}) {
  const proj = getCurrentProject();
  if (!proj || !path) return null;

  const record = {
    id: `${proj.projectId}-file-${path}`,
    projectId: proj.projectId,
    path,
    folder: meta.folder || path.split('/')[0] || 'NovelMD',
    content: String(markdown || ''),
    updatedAt: nowIso(),
    ...meta,
  };

  const idx = cache.files.findIndex((f) => f.path === path);
  if (idx >= 0) cache.files[idx] = { ...cache.files[idx], ...record };
  else cache.files.push(record);
  await storage.put('files', record);
  return record;
}

/** 에피소드 요약 필드 갱신 */
export async function updateEpisodeSummary(episodeId, summary) {
  const ep = cache.episodes.find((e) => e.id === episodeId);
  if (!ep) return null;
  const updated = {
    ...ep,
    summary: String(summary || '').trim(),
    updatedAt: nowIso(),
  };
  const idx = cache.episodes.findIndex((e) => e.id === episodeId);
  if (idx >= 0) cache.episodes[idx] = updated;
  await storage.put('episodes', updated);
  return updated;
}

/** 인물 카드 MD를 IndexedDB files에 등록 (GitHub overlays/characters 로 동기화) */
export async function upsertCharacterCardMarkdown(character, markdown) {
  const proj = getCurrentProject();
  if (!proj || !character) return null;

  const cid = character.characterId || String(character.id || '').split('-').pop() || 'CHR0000';
  const safeName = String(character.name || cid).replace(/[^\w가-힣\-]+/g, '_');
  const filename = `${cid}_${safeName}.md`;
  const path = `CharacterCards/${filename}`;
  const record = {
    id: `${proj.projectId}-file-${path}`,
    projectId: proj.projectId,
    path,
    folder: 'CharacterCards',
    content: markdown,
    characterId: character.id,
    updatedAt: nowIso(),
  };

  const idx = cache.files.findIndex((f) => f.path === path);
  if (idx >= 0) cache.files[idx] = record;
  else cache.files.push(record);
  await storage.put('files', record);
  return record;
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
  const layout = await storage.get('settings', `${currentProject.projectId}-character-layout`);

  return JSON.stringify({

    format: 'foreshadow-backup',

    version: 1,

    project: currentProject,

    ...cache,

    settings: {

      canvasWallpaper: wallpaper || null,

      characterLayout: layout || null,

    },

    exportedAt: nowIso(),

  }, null, 2);

}



/** 백업 JSON 인물 — 레거시 필드·ID 정규화 후 사진 복원 */
function normalizeImportedCharacter(item, projectId) {
  const characterId = item.characterId
    || String(item.id || '').split('-').filter(Boolean).pop()
    || String(item.id || 'CHR0000');

  let avatarDataUrl = item.avatarDataUrl
    || item.image
    || item.avatar
    || item.avatarUrl
    || item.photo
    || '';

  let images = [];
  if (Array.isArray(item.images)) images = [...item.images];
  else if (Array.isArray(item.photos)) images = [...item.photos];
  else if (Array.isArray(item.gallery)) images = [...item.gallery];

  avatarDataUrl = String(avatarDataUrl || '').trim();
  images = images.map((u) => String(u || '').trim()).filter(Boolean);

  if (avatarDataUrl && !images.includes(avatarDataUrl)) images.unshift(avatarDataUrl);
  if (!avatarDataUrl && images.length) avatarDataUrl = images[0];

  return {
    ...item,
    id: `${projectId}-${characterId}`,
    projectId,
    characterId,
    avatarDataUrl,
    images,
    updatedAt: item.updatedAt || nowIso(),
    createdAt: item.createdAt || nowIso(),
  };
}



export async function importProjectJson(jsonText) {

  const user = getCurrentUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  // 열기(import)는 모든 로그인 사용자 허용. 생성·저장만 관리자 제한.
  // clearAllProjects 이후 호출되므로 소유 개수 제한은 적용하지 않음.

  const data = JSON.parse(jsonText);

  const projectId = uuid();

  const incoming = data.project || {};
  // 소유권·쓰기 권한은 JSON에 있는 값을 유지 (열람자가 가로채지 않음)
  let ownerId = String(incoming.ownerId || '').trim();
  let writers = normalizeWriters(incoming.writers);
  let writerUsernames = normalizeWriterNames(incoming.writerUsernames);
  if (!writers.length && ownerId) writers = [ownerId];

  const project = ensureProjectAcl({
    ...incoming,
    id: projectId,
    projectId,
    ownerId,
    writers,
    writerUsernames,
    author: incoming.author || '',
    createdAt: incoming.createdAt || nowIso(),
    updatedAt: nowIso(),
  });

  await storage.put('projects', project);



  const remap = (items, key) => (items || []).map((item) => ({

    ...item,

    id: `${projectId}-${item[key] || item.id}`,

    projectId,

  }));

  const characters = (data.characters || []).map((item) => normalizeImportedCharacter(item, projectId));

  const oldToNewCharId = new Map();
  (data.characters || []).forEach((raw, i) => {
    const norm = characters[i];
    if (raw?.id) oldToNewCharId.set(raw.id, norm.id);
    if (raw?.characterId) oldToNewCharId.set(raw.characterId, norm.id);
    if (norm?.characterId) oldToNewCharId.set(norm.characterId, norm.id);
  });



  await storage.bulkPut('stories', remap(data.stories, 'storyId'));

  await storage.bulkPut('episodes', remap(data.episodes, 'episodeId'));

  await storage.bulkPut('characters', characters);

  await storage.bulkPut('sceneCuts', (data.sceneCuts || []).map((item, index) => {
    const rawSceneCutId = item.sceneCutId
      || String(item.id || '').split('-').filter(Boolean).pop()
      || `SCN${String(index + 1).padStart(4, '0')}`;
    return {
      ...item,
      id: `${projectId}-${rawSceneCutId}`,
      projectId,
      sceneCutId: rawSceneCutId,
      name: String(item.name || '').trim(),
      description: String(item.description || '').trim(),
      image: String(item.image || '').trim(),
      imagePath: String(item.imagePath || '').trim(),
      createdAt: item.createdAt || nowIso(),
      updatedAt: item.updatedAt || nowIso(),
    };
  }));

  await storage.bulkPut('worlds', remap(data.worlds, 'worldId'));

  await storage.bulkPut('foreshadows', remap(data.foreshadows, 'foreshadowId'));

  await storage.bulkPut('timeline', remap(data.timeline, 'eventId'));

  await storage.bulkPut('files', (data.files || []).map((f) => ({

    ...f,

    id: `${projectId}-file-${f.path}`,

    projectId,

  })));



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

  const layout = data.settings?.characterLayout;
  if (layout?.positions) {
    const remapped = {};
    for (const [oldId, pos] of Object.entries(layout.positions)) {
      const newId = oldToNewCharId.get(oldId) || oldId;
      remapped[newId] = pos;
    }
    await storage.put('settings', {
      id: `${projectId}-character-layout`,
      projectId,
      positions: remapped,
      updatedAt: nowIso(),
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


