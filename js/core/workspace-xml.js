/** Workspace XML DB — 섹션별 XML 로드 (뷰마다 다른 캔버스 XML) */

import { emit } from './events.js';

/** Pages(/NovelExplor/)·로컬 모두: 이 모듈 기준 앱 루트 */
const APP_BASE = new URL('../../', import.meta.url);
const MANIFEST_URL = new URL('data/workspace/workspace.xml', APP_BASE).href;

/** @type {{ version: string, projectTitle: string, sections: Map<string, SectionMeta> } | null} */
let manifest = null;

/** viewId → 파싱된 섹션 문서 캐시 */
const sectionCache = new Map();

/** @typedef {{ id: string, viewId: string, title: string, src: string }} SectionMeta */

/**
 * 매니페스트(workspace.xml) 로드. 앱 부팅 시 1회.
 * @returns {Promise<typeof manifest>}
 */
export async function loadWorkspaceManifest() {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`workspace.xml 로드 실패 (${res.status})`);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('workspace.xml 파싱 오류');
  }

  const root = doc.documentElement;
  const sections = new Map();
  doc.querySelectorAll('Sections > Section').forEach((el) => {
    const viewId = el.getAttribute('viewId') || el.getAttribute('id');
    if (!viewId) return;
    sections.set(viewId, {
      id: el.getAttribute('id') || viewId,
      viewId,
      title: el.getAttribute('title') || viewId,
      src: el.getAttribute('src') || '',
    });
  });

  manifest = {
    version: root.getAttribute('version') || '1',
    projectTitle: root.getAttribute('projectTitle') || '',
    sections,
  };

  emit('workspace-xml:manifest', manifest);
  return manifest;
}

export function getManifest() {
  return manifest;
}

export function getSectionMeta(viewId) {
  return manifest?.sections.get(viewId) || null;
}

/**
 * 뷰에 해당하는 섹션 XML만 로드 (소설 읽기 ≠ 인물).
 * @param {string} viewId
 * @returns {Promise<{ meta: SectionMeta, doc: Document, xmlUrl: string } | null>}
 */
export async function loadSectionForView(viewId) {
  if (!manifest) {
    try {
      await loadWorkspaceManifest();
    } catch (err) {
      console.warn('[workspace-xml]', err.message);
      return null;
    }
  }

  const meta = getSectionMeta(viewId);
  if (!meta?.src) {
    emit('workspace-xml:section', { viewId, meta: null, doc: null });
    return null;
  }

  if (sectionCache.has(viewId)) {
    const cached = sectionCache.get(viewId);
    emit('workspace-xml:section', { viewId, ...cached });
    return cached;
  }

  const xmlUrl = resolveWorkspaceUrl(meta.src);
  const res = await fetch(xmlUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`섹션 XML 로드 실패: ${meta.src} (${res.status})`);

  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error(`섹션 XML 파싱 오류: ${meta.src}`);
  }

  const payload = { meta, doc, xmlUrl };
  sectionCache.set(viewId, payload);
  emit('workspace-xml:section', { viewId, ...payload });
  return payload;
}

/** 캐시 무효화 (등록/동기화 후) */
export function invalidateSection(viewId) {
  if (viewId) sectionCache.delete(viewId);
  else sectionCache.clear();
}

/**
 * 섹션 XML 기준 상대 경로 → 앱 루트 URL
 * @param {string} relativeFromSection  예: ../../data/seed/episodes/EP001.md
 * @param {string} sectionXmlUrl        예: .../data/workspace/sections/10_reader.xml
 */
export function resolveAssetUrl(relativeFromSection, sectionXmlUrl) {
  if (!relativeFromSection) return '';
  if (/^https?:\/\//i.test(relativeFromSection)) return relativeFromSection;
  return new URL(relativeFromSection, sectionXmlUrl).href;
}

function resolveWorkspaceUrl(srcFromManifest) {
  // manifest 기준: sections/00_master.xml → data/workspace/sections/...
  return new URL(srcFromManifest, MANIFEST_URL).href;
}

/** Character 노드 목록 파싱 */
export function parseCharacters(doc) {
  return [...doc.querySelectorAll('Characters > Character')].map((el) => ({
    id: el.getAttribute('id'),
    name: el.getAttribute('name') || '',
    race: el.getAttribute('race') || '',
    gender: el.getAttribute('gender') || '',
    age: el.getAttribute('age') || '',
    occupation: el.getAttribute('occupation') || '',
    firstEpisode: el.getAttribute('firstEpisode') || '',
    lastEpisode: el.getAttribute('lastEpisode') || '',
    status: el.getAttribute('status') || '',
    description: el.querySelector('Description')?.textContent?.trim() || '',
    avatarSrc: el.querySelector('Avatar')?.getAttribute('src') || '',
  }));
}

/** Reader Stories 파싱 */
export function parseStories(doc) {
  return [...doc.querySelectorAll('Stories > Story')].map((el) => ({
    id: el.getAttribute('id'),
    number: Number(el.getAttribute('number') || 0),
    title: el.getAttribute('title') || '',
    src: el.getAttribute('src') || '',
    mime: el.getAttribute('mime') || 'text/markdown',
  }));
}

/** Foreshadow 파싱 */
export function parseForeshadows(doc) {
  return [...doc.querySelectorAll('Foreshadows > Foreshadow')].map((el) => ({
    id: el.getAttribute('id'),
    title: el.getAttribute('title') || '',
    grade: el.getAttribute('grade') || '',
    status: el.getAttribute('status') || '',
    createdEpisode: el.getAttribute('createdEpisode') || '',
    expectedEpisode: el.getAttribute('expectedEpisode') || '',
  }));
}

/** Timeline Events 파싱 */
export function parseTimeline(doc) {
  return [...doc.querySelectorAll('Events > Event')].map((el) => ({
    id: el.getAttribute('id'),
    episode: el.getAttribute('episode') || '',
    date: el.getAttribute('date') || '',
    title: el.getAttribute('title') || '',
  }));
}

/** Master Meta 파싱 */
export function parseMasterFields(doc) {
  const fields = {};
  doc.querySelectorAll('Meta > Field').forEach((el) => {
    const name = el.getAttribute('name');
    if (name) fields[name] = el.textContent?.trim() || '';
  });
  return fields;
}
