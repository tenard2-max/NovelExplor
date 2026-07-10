/** 배포 빌드 버전 — 커밋·푸시 시 scripts/bump-version.js 로 갱신 */

export const APP_BUILD = '20260711080500';
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
    return localStorage.getItem(UPLOAD_VERSION_KEY) || '';
  } catch {
    return '';
  }
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
    return localStorage.getItem(JSON_VERSION_KEY) || '';
  } catch {
    return '';
  }
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

/** YYYYMMDDHHMMSS.json · ForeshadowBackup_..._2026-07-10T05-33-25.json */
export function stampFromBackupFilename(name = '') {
  const base = String(name).split(/[/\\]/).pop() || '';
  const m14 = base.match(/(\d{14})\.json$/i);
  if (m14) return m14[1];
  const mIso = base.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (mIso) {
    return `${mIso[1]}${mIso[2]}${mIso[3]}${mIso[4]}${mIso[5]}${mIso[6]}`;
  }
  return '';
}

export function refreshNavVersions() {
  const pushEl = document.getElementById('nav-app-version');
  if (pushEl) pushEl.textContent = `APP: ${formatAppBuild(APP_BUILD)}`;

  const jsonEl = document.getElementById('nav-json-version');
  if (jsonEl) jsonEl.textContent = formatJsonVersionNav();

  const uploadEl = document.getElementById('nav-upload-version');
  if (uploadEl) uploadEl.textContent = formatUploadVersionNav();
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

async function fetchJsonStamp(url) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
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

/** GitHub latest.json · upload-latest.json → 실패 시 로컬 data/workspace 폴백 */
export async function refreshNavVersionsFromGithub() {
  try {
    const { rawGithubUrl, snapshotsDir, overlaysDir } = await import('./core/github-config.js');
    const jsonStamp = await fetchJsonStamp(rawGithubUrl(`${snapshotsDir()}/latest.json`));
    if (jsonStamp) setJsonVersionStamp(jsonStamp);
    const uploadStamp = await fetchJsonStamp(rawGithubUrl(`${overlaysDir()}/upload-latest.json`));
    if (uploadStamp) setUploadVersionStamp(uploadStamp);
  } catch {
    /* GitHub 미반영·오프라인 */
  }

  // 로컬 서버(127.0.0.1:9000) — 워크스페이스 파일에서 직접 읽기
  if (!getJsonVersionStamp()) {
    const stamp = await fetchJsonStamp('data/workspace/snapshots/latest.json');
    if (stamp) setJsonVersionStamp(stamp);
  }
  if (!getUploadVersionStamp()) {
    const stamp = await fetchJsonStamp('data/workspace/overlays/upload-latest.json');
    if (stamp) setUploadVersionStamp(stamp);
  }

  refreshNavVersions();
}
