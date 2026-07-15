/** 프로젝트 자산 백그라운드 캐시 — raw 다운로드, 우선순위 큐, 실패 격리 */

import { on, emit } from './events.js';
import * as project from './project.js';
import * as storage from './storage.js';
import { trackedRawFetch } from './github-metrics.js';
import {
  getCharacterRepresentativeUrl,
  listCharacterGalleryEntries,
  resolveMediaSrc,
} from './character-media.js';

export const PROJECT_ASSET_CACHE = 'ne-project-assets-v1';

const MAX_CONCURRENCY = 2;
const PRIORITY = {
  READER_CURRENT: 0,
  CURRENT_VIEW: 10,
  CURRENT_VIEW_SECONDARY: 20,
  BACKGROUND: 100,
};

/** @type {Map<string, { url: string, priority: number, order: number }>} */
const queue = new Map();
const activeUrls = new Set();
const failedUrls = new Set();

let initialized = false;
let activeCount = 0;
let order = 0;
let currentView = '';
let currentReaderText = '';
let pumpTimer = null;

export function initBackgroundAssets() {
  if (initialized) return;
  initialized = true;

  on('project:loaded', () => {
    queue.clear();
    failedUrls.clear();
    currentReaderText = '';
    reprioritizeForView(currentView).catch(reportFailure);
  });

  on('view:changed', (viewId) => {
    currentView = String(viewId || '');
    reprioritizeForView(currentView).catch(reportFailure);
  });

  on('reader:content-ready', ({ markdown } = {}) => {
    currentReaderText = String(markdown || '');
    prioritizeReaderAssets(currentReaderText);
    schedulePump();
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('online', schedulePump);
  }
}

/** 현재 화에서 실제로 언급된 인물·장면컷을 최우선으로 올린다. */
export function prioritizeReaderAssets(markdown) {
  const cache = project.getCache();
  const text = String(markdown || '');
  if (!text) return [];

  const urls = [];
  for (const character of cache.characters || []) {
    const names = [character.name, ...(character.alias || [])]
      .map((name) => String(name || '').trim())
      .filter(Boolean);
    if (!names.some((name) => text.includes(name))) continue;
    const url = getCharacterRepresentativeUrl(character);
    if (url) urls.push(url);
  }

  const sceneNames = new Set(
    [...text.matchAll(/\[([^\]]+)\]/g)]
      .map((match) => String(match[1] || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  );
  for (const sceneCut of cache.sceneCuts || []) {
    if (!sceneNames.has(String(sceneCut.name || '').trim())) continue;
    const url = getSceneCutUrl(sceneCut);
    if (url) urls.push(url);
  }

  enqueueAssets(urls, PRIORITY.READER_CURRENT);
  return [...new Set(urls)];
}

async function reprioritizeForView(viewId) {
  // 진행 중 다운로드는 중단하지 않고, 대기 항목만 배경 우선순위로 낮춘다.
  for (const item of queue.values()) item.priority = PRIORITY.BACKGROUND;

  const cache = project.getCache();
  const characters = cache.characters || [];
  const sceneCuts = cache.sceneCuts || [];

  if (viewId === 'reader') {
    prioritizeReaderAssets(currentReaderText);
  } else if (viewId === 'character' || viewId === 'graph-character') {
    enqueueAssets(
      characters.map(getCharacterRepresentativeUrl),
      PRIORITY.CURRENT_VIEW
    );
    if (viewId === 'character') {
      enqueueAssets(
        characters.flatMap((character) =>
          listCharacterGalleryEntries(character).map((entry) => entry.url)
        ),
        PRIORITY.CURRENT_VIEW_SECONDARY
      );
    }
  } else if (viewId === 'scene-cuts') {
    enqueueAssets(sceneCuts.map(getSceneCutUrl), PRIORITY.CURRENT_VIEW);
  }

  // 현재 화면 자산 이후에는 나머지를 천천히 받아 오프라인 캐시를 채운다.
  enqueueAssets(
    characters.flatMap((character) => [
      getCharacterRepresentativeUrl(character),
      ...listCharacterGalleryEntries(character).map((entry) => entry.url),
    ]),
    PRIORITY.BACKGROUND
  );
  enqueueAssets(sceneCuts.map(getSceneCutUrl), PRIORITY.BACKGROUND);

  const wallpaperUrl = await getWallpaperUrl();
  if (wallpaperUrl) {
    enqueueAssets(
      [wallpaperUrl],
      viewId === 'reader' ? PRIORITY.CURRENT_VIEW : PRIORITY.BACKGROUND
    );
  }
  schedulePump();
}

function getSceneCutUrl(sceneCut) {
  return resolveMediaSrc(sceneCut?.image || sceneCut?.imagePath || '');
}

async function getWallpaperUrl() {
  const current = project.getCurrentProject();
  if (!current) return '';
  try {
    const saved = await storage.get(
      'settings',
      `${current.projectId}-canvas-wallpaper`
    );
    return resolveMediaSrc(saved?.dataUrl || saved?.dataPath || '');
  } catch {
    return '';
  }
}

export function enqueueAssets(urls, priority = PRIORITY.BACKGROUND) {
  for (const value of urls || []) {
    const url = String(value || '').trim();
    if (!isCacheableUrl(url) || failedUrls.has(url) || activeUrls.has(url)) continue;

    const existing = queue.get(url);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      continue;
    }
    queue.set(url, { url, priority, order: order++ });
  }
  schedulePump();
}

function isCacheableUrl(url) {
  return /^https?:\/\//i.test(url);
}

function schedulePump() {
  if (pumpTimer != null) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pump();
  }, 0);
}

function pump() {
  if (!canDownload() || typeof caches === 'undefined') return;

  while (activeCount < MAX_CONCURRENCY && queue.size) {
    const item = nextItem();
    if (!item) return;
    queue.delete(item.url);
    activeUrls.add(item.url);
    activeCount += 1;

    cacheAsset(item.url)
      .catch(() => {
        // 자산 실패는 프로젝트 열기·읽기·화면 표시 실패로 전파하지 않는다.
        failedUrls.add(item.url);
      })
      .finally(() => {
        activeUrls.delete(item.url);
        activeCount -= 1;
        emitStatus();
        schedulePump();
      });
  }
  emitStatus();
}

function nextItem() {
  return [...queue.values()].sort(
    (a, b) => a.priority - b.priority || a.order - b.order
  )[0] || null;
}

async function cacheAsset(url) {
  const cache = await caches.open(PROJECT_ASSET_CACHE);
  if (await cache.match(url)) return;

  const response = await trackedRawFetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`asset fetch failed: ${response.status}`);
  await cache.put(url, response.clone());
}

function canDownload() {
  if (typeof navigator === 'undefined') return true;
  if (navigator.onLine === false) return false;
  return !navigator.connection?.saveData;
}

function emitStatus() {
  emit('asset-cache:status', {
    pending: queue.size,
    active: activeCount,
    failed: failedUrls.size,
  });
}

function reportFailure(error) {
  console.warn('[background-assets] 자산 큐 구성 실패:', error);
}
