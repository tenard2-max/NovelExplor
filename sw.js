/* NovelExplor PWA service worker — app shell cache */
const CACHE_VERSION = 'ne-pwa-v2-20260715c';
const PROJECT_ASSET_CACHE = 'ne-project-assets-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/variables.css',
  './css/layout.css',
  './css/components.css',
  './css/themes.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION && k !== PROJECT_ASSET_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // GitHub raw 프로젝트 자산: 백그라운드 큐와 공유하는 영속 캐시 우선.
  // 실패 시 원 응답을 반환해 앱 열기·읽기 흐름을 막지 않는다.
  if (url.hostname === 'raw.githubusercontent.com') {
    event.respondWith(
      caches.open(PROJECT_ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const response = await fetch(req);
        if (response?.ok) {
          cache.put(req, response.clone()).catch(() => {});
        }
        return response;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // HTML / JS / CSS / JSON / XML: network first — 배포 직후 옛 캐시로 UI가 깨지지 않게
  if (
    /\.(js|mjs|css|json|xml|webmanifest)(\?|$)/i.test(url.pathname)
    || req.mode === 'navigate'
    || (req.headers.get('accept') || '').includes('text/html')
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // 아이콘 등 정적 이미지: cache first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      });
    })
  );
});
