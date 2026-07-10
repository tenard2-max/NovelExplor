/** 배포 빌드 버전 — 커밋·푸시 시 scripts/bump-version.js 로 갱신 */

export const APP_BUILD = '20260710154344';

/** YYYYMMDDHHMMSS → YYYY-MM-DD HH:MM:SS */
export function formatAppBuild(stamp = APP_BUILD) {
  const s = String(stamp || '');
  if (!/^\d{14}$/.test(s)) return s || '—';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
}
