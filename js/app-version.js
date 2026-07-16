/** 배포 빌드 버전 — 커밋·푸시 시 scripts/bump-version.js 로 갱신 */

import { trackedRawFetch } from './core/github-metrics.js';

export const APP_BUILD = '20260716104754';

/**
 * 로컬/오프라인에서도 네비에 표시할 기본 스탬프.
 * scripts/bump-version.js 가 data/workspace 의 latest.json 기준으로 갱신한다.
 */
export const FALLBACK_JSON_STAMP = '20260711181754_유진이의_모험2(완결)';
export const FALLBACK_UPLOAD_STAMP = '20260713221739';

const JSON_VERSION_KEY = 'fft-json-version';
const UPLOAD_VERSION_KEY = 'fft-upload-version';

/** 업로드(PNG·MD·TXT) GitHub 반영 시각 — GitHub upload-latest.json 기준 */
export function formatUploadVersionNav(stamp = getUploadVersionStamp()) {
  if (!stamp) return 'UPLOAD: —';
  const s = String(stamp).replace(/\.json$/i, '');
  if (/^\d{14}$/.test(s)) return `UPLOAD: ${s}`;
  return `UPLOAD: ${s}`;
}

export function getUploadVersionStamp() {
  try {
    const stored = localStorage.getItem(UPLOAD_VERSION_KEY) || '';
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return FALLBACK_UPLOAD_STAMP || '';
}

export function setUploadVersionStamp(stamp) {
  try {
    if (!stamp) localStorage.removeItem(UPLOAD_VERSION_KEY);
    else localStorage.setItem(UPLOAD_VERSION_KEY, String(stamp));
  } catch {
    /* ignore */
  }
}

/** YYYYMMDDHHMMSS → YYYY-MM-DD HH:MM:SS */
export function formatAppBuild(stamp = APP_BUILD) {
  const s = String(stamp || '');
  if (!/^\d{14}$/.test(s)) return s || '—';
  return formatStamp14(s);
}

/** JSON 버전 라벨 — GitHub 스냅샷 파일명(14자리) */
export function formatJsonVersionNav(stamp = getJsonVersionStamp()) {
  if (!stamp) return 'JSON: —';
  const s = String(stamp).replace(/\.json$/i, '');
  if (/^\d{14}$/.test(s)) return `JSON: ${s}`;
  return `JSON: ${s}`;
}

export function formatStamp14(stamp) {
  const s = String(stamp || '');
  if (!/^\d{14}$/.test(s)) return s || '—';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
}

export function getJsonVersionStamp() {
  try {
    const stored = localStorage.getItem(JSON_VERSION_KEY) || '';
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return FALLBACK_JSON_STAMP || '';
}

export function setJsonVersionStamp(stamp) {
  try {
    if (!stamp) localStorage.removeItem(JSON_VERSION_KEY);
    else localStorage.setItem(JSON_VERSION_KEY, String(stamp));
  } catch {
    /* ignore */
  }
}

export function formatJsonVersionLabel(stamp = getJsonVersionStamp()) {
  if (!stamp) return '—';
  if (/^\d{14}$/.test(stamp)) return formatStamp14(stamp);
  const d = new Date(stamp);
  if (!Number.isNaN(d.getTime())) return formatAppBuild(stampFromDate(d));
  return String(stamp);
}

export function stampFromDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function stampFromExportedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return stampFromDate(d);
}

/** YYYYMMDDHHMMSS.json · YYYYMMDDHHMMSS_테마.json · ForeshadowBackup_... */
export function stampFromBackupFilename(name = '') {
  const base = String(name).split(/[/\\]/).pop() || '';
  const mTheme = base.match(/^(\d{14}(?:_[^.]+)?)\.json$/i);
  if (mTheme) return mTheme[1];
  const m14 = base.match(/(\d{14})\.json$/i);
  if (m14) return m14[1];
  const mIso = base.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (mIso) {
    return `${mIso[1]}${mIso[2]}${mIso[3]}${mIso[4]}${mIso[5]}${mIso[6]}`;
  }
  return '';
}

function setNavText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
  return Boolean(el);
}

export function refreshNavVersions() {
  if (typeof document === 'undefined') return;
  setNavText('nav-app-version', `APP: ${formatAppBuild(APP_BUILD)}`);
  setNavText('nav-json-version', formatJsonVersionNav());
  setNavText('nav-upload-version', formatUploadVersionNav());
}

/** UPLOAD 아래 Trees 커밋 진행률 */
export function setNavSyncProgress(label = '', { error = false } = {}) {
  const el = document.getElementById('nav-sync-progress');
  if (!el) return;
  const text = String(label || '').trim();
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error', 'is-active');
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('is-error', Boolean(error));
  el.classList.toggle('is-active', !error);
  el.title = text;
}

export function clearNavSyncProgress() {
  setNavSyncProgress('');
}

function resolveWorkspaceUrls(relPath) {
  const urls = [];
  try {
    urls.push(new URL(relPath, document.baseURI).href);
  } catch {
    urls.push(relPath);
  }
  // foreshadow-engine/ 하위 진입 시 상위 data/ 경로
  try {
    urls.push(new URL(`../${relPath}`, document.baseURI).href);
  } catch {
    /* ignore */
  }
  urls.push(`/${relPath}`);
  return [...new Set(urls)];
}

async function fetchJsonStamp(url) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
  try {
    const joiner = url.includes('?') ? '&' : '?';
    const res = await trackedRawFetch(`${url}${joiner}t=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl?.signal,
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.snapshotId || data.uploadId || stampFromBackupFilename(data.filename || '') || '';
  } catch {
    return '';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchFirstStamp(urls) {
  for (const url of urls) {
    const stamp = await fetchJsonStamp(url);
    if (stamp) return stamp;
  }
  return '';
}

/** GitHub latest.json · upload-latest.json → 로컬 data/workspace 폴백 (상수는 이미 표시됨) */
export async function refreshNavVersionsFromGithub() {
  // 네트워크 전에 상수/캐시로 즉시 표시
  refreshNavVersions();

  try {
    const { rawGithubUrl, snapshotsDir, overlaysDir } = await import('./core/github-config.js');
    const jsonStamp = await fetchJsonStamp(rawGithubUrl(`${snapshotsDir()}/latest.json`));
    if (jsonStamp) setJsonVersionStamp(jsonStamp);
    const uploadStamp = await fetchJsonStamp(rawGithubUrl(`${overlaysDir()}/upload-latest.json`));
    if (uploadStamp) setUploadVersionStamp(uploadStamp);
  } catch {
    /* GitHub 미반영·오프라인 */
  }

  // 로컬 워크스페이스 (루트·하위 경로 모두 시도)
  const localJson = await fetchFirstStamp(resolveWorkspaceUrls('data/workspace/snapshots/latest.json'));
  if (localJson) setJsonVersionStamp(localJson);
  const localUpload = await fetchFirstStamp(resolveWorkspaceUrls('data/workspace/overlays/upload-latest.json'));
  if (localUpload) setUploadVersionStamp(localUpload);

  refreshNavVersions();
}

/** DOM이 준비되는 즉시 네비 버전 채움 (boot 실패와 무관) */
function paintNavVersionsWhenReady() {
  if (typeof document === 'undefined') return;
  const run = () => refreshNavVersions();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
}

paintNavVersionsWhenReady();
