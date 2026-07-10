/** 배포 빌드 버전 — 커밋·푸시 시 scripts/bump-version.js 로 갱신 */

export const APP_BUILD = '20260710155230';
const JSON_VERSION_KEY = 'fft-json-version';

/** YYYYMMDDHHMMSS → YYYY-MM-DD HH:MM:SS */
export function formatAppBuild(stamp = APP_BUILD) {
  const s = String(stamp || '');
  if (!/^\d{14}$/.test(s)) return s || '—';
  return formatStamp14(s);
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
  if (pushEl) pushEl.textContent = formatAppBuild(APP_BUILD);

  const jsonEl = document.getElementById('nav-json-version');
  if (jsonEl) {
    const label = formatJsonVersionLabel();
    jsonEl.textContent = label === '—' ? 'JSON: —' : `JSON: ${label}`;
  }
}
