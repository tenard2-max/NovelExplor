/** 스토리 MD → assets/stories + 10_reader.xml + workspace.xml 동기화 */

import { padStory, extractStoryReaderTitle } from './utils.js';
import {
  loadWorkspaceManifest,
  loadSectionForView,
  invalidateSection,
  replaceSectionCache,
  replaceManifestText,
  getManifestXmlText,
  getManifestXmlUrl,
} from './workspace-xml.js';
import { hasSessionToken, putTextFiles, getRepoLabel } from './github-api.js';

const READER_REL = 'sections/10_reader.xml';
const MANIFEST_REL = 'workspace.xml';
const ASSETS_STORIES = 'assets/stories';

/** @type {FileSystemDirectoryHandle | null} */
let workspaceDirHandle = null;

export function getWorkspaceDirHandle() {
  return workspaceDirHandle;
}

export async function pickWorkspaceDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error('이 브라우저는 폴더 연결(File System Access)을 지원하지 않습니다. 다운로드 폴백을 사용합니다.');
  }
  workspaceDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  return workspaceDirHandle;
}

export function clearWorkspaceDirectory() {
  workspaceDirHandle = null;
}

/**
 * ST MD 업로드 후 워크스페이스 동기화
 * @param {{ number: number, title?: string, content: string, filename?: string }} story
 * @returns {Promise<{
 *   storyId: string,
 *   assetPath: string,
 *   readerSrc: string,
 *   local: 'fs'|'download'|'skip',
 *   github: 'committed'|'skipped'|'failed',
 *   githubError?: string,
 *   files: Array<{ path: string, content: string }>
 * }>}
 */
export async function syncUploadedStory(story) {
  const num = story.number;
  const storyId = padStory(num);
  const title = (story.title || extractStoryReaderTitle(story.content, storyId)).trim() || storyId;
  const assetPath = `${ASSETS_STORIES}/${storyId}.md`;
  const readerSrc = `../${assetPath}`;
  const repoAssetPath = `data/workspace/${assetPath}`;
  const repoReaderPath = `data/workspace/${READER_REL}`;
  const repoManifestPath = `data/workspace/${MANIFEST_REL}`;

  await loadWorkspaceManifest().catch(() => null);
  const readerPayload = await loadSectionForView('reader');
  if (!readerPayload?.doc) {
    throw new Error('10_reader.xml을 불러올 수 없습니다.');
  }

  const readerXml = upsertReaderStory(
    serializeXml(readerPayload.doc),
    { id: storyId, number: num, title, src: readerSrc }
  );
  const readerDoc = parseXml(readerXml);
  replaceSectionCache('reader', readerDoc, readerPayload.xmlUrl);

  let manifestXml = getManifestXmlText();
  if (!manifestXml) {
    const manifestUrl = getManifestXmlUrl();
    const manifestRes = await fetch(manifestUrl, { cache: 'no-store' });
    if (!manifestRes.ok) throw new Error(`workspace.xml 로드 실패 (${manifestRes.status})`);
    manifestXml = await manifestRes.text();
  }
  manifestXml = upsertWorkspaceAsset(manifestXml, {
    id: `${storyId.toLowerCase()}-md`,
    path: assetPath,
    mime: 'text/markdown',
  });
  replaceManifestText(manifestXml);

  const files = [
    { path: repoAssetPath, content: story.content, localRel: assetPath },
    { path: repoReaderPath, content: ensureXmlDecl(readerXml), localRel: READER_REL },
    { path: repoManifestPath, content: ensureXmlDecl(manifestXml), localRel: MANIFEST_REL },
  ];

  let local = 'skip';
  if (workspaceDirHandle) {
    try {
      for (const f of files) {
        await writeRelativeFile(workspaceDirHandle, f.localRel, f.content);
      }
      local = 'fs';
    } catch (err) {
      console.warn('[workspace-sync] FS 저장 실패:', err);
    }
  }

  let github = 'skipped';
  let githubError;
  if (hasSessionToken()) {
    try {
      await putTextFiles(
        files.map((f) => ({ path: f.path, content: f.content })),
        `chore(workspace): sync ${storyId} story upload`
      );
      github = 'committed';
    } catch (err) {
      github = 'failed';
      githubError = err.message;
      console.warn('[workspace-sync] GitHub 커밋 실패:', err);
    }
  }

  // FS·GitHub 모두 실패/미사용이면 다운로드로 로컬 확보
  if (local !== 'fs' && github !== 'committed') {
    for (const f of files) {
      downloadTextFile(f.localRel.split('/').pop(), f.content);
    }
    local = 'download';
  }

  return {
    storyId,
    assetPath,
    readerSrc,
    local,
    github,
    githubError,
    repo: getRepoLabel(),
    files: files.map((f) => ({ path: f.path, content: f.content })),
  };
}

async function writeRelativeFile(rootHandle, relativePath, content) {
  const parts = relativePath.split('/').filter(Boolean);
  let dir = rootHandle;
  for (let i = 0; i < parts.length - 1; i += 1) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function upsertReaderStory(xmlText, { id, number, title, src }) {
  const doc = parseXml(xmlText);
  let stories = doc.querySelector('Stories');
  if (!stories) {
    stories = doc.createElement('Stories');
    doc.documentElement.appendChild(stories);
  }

  let el = [...stories.querySelectorAll('Story')].find(
    (n) => n.getAttribute('id') === id || n.getAttribute('number') === String(number)
  );
  if (!el) {
    el = doc.createElement('Story');
    stories.appendChild(el);
  }
  el.setAttribute('id', id);
  el.setAttribute('number', String(number));
  el.setAttribute('title', title);
  el.setAttribute('src', src);
  el.setAttribute('mime', 'text/markdown');
  return serializeXml(doc);
}

function upsertWorkspaceAsset(xmlText, { id, path, mime }) {
  const doc = parseXml(xmlText);
  let assets = doc.querySelector('Assets');
  if (!assets) {
    assets = doc.createElement('Assets');
    assets.setAttribute('root', 'assets/');
    doc.documentElement.appendChild(assets);
  }

  let el = [...assets.querySelectorAll('File')].find(
    (n) => n.getAttribute('id') === id || n.getAttribute('path') === path
  );
  if (!el) {
    el = doc.createElement('File');
    assets.appendChild(el);
  }
  el.setAttribute('id', id);
  el.setAttribute('path', path);
  el.setAttribute('mime', mime || 'text/markdown');

  doc.documentElement.setAttribute('updatedAt', new Date().toISOString());
  return serializeXml(doc);
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 파싱 오류');
  return doc;
}

function serializeXml(doc) {
  return new XMLSerializer().serializeToString(doc);
}

function ensureXmlDecl(xml) {
  const trimmed = xml.trim();
  if (trimmed.startsWith('<?xml')) return trimmed;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${trimmed}`;
}

/** 테스트/상태용 */
export function invalidateReaderCache() {
  invalidateSection('reader');
}
