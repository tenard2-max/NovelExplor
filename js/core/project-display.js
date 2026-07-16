/** 프로젝트 제목 · 파일명(테마) 표시 헬퍼 */

/**
 * 스냅샷/백업 파일명에서 테마 태그 추출
 * @param {string} filename
 * @returns {string}
 */
export function themeTagFromSnapshotName(filename) {
  const name = String(filename || '').replace(/^.*[\\/]/, '');
  const m = name.match(/^\d{14}(?:_([^.]+))?\.json$/i);
  return m?.[1] || '';
}

/**
 * 표시용으로 공백/_ 정규화
 * @param {string} value
 */
export function normalizeDisplayTitle(value) {
  return String(value || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * 프로젝트 제목과 파일명 테마가 다른지
 * @param {string} title
 * @param {string} filename
 */
export function projectTitleDiffersFromFileTheme(title, filename) {
  const theme = themeTagFromSnapshotName(filename);
  if (!theme) return false;
  const t = normalizeDisplayTitle(title);
  if (!t) return false;
  return t !== normalizeDisplayTitle(theme);
}

/**
 * 목록/미리보기용 짧은 힌트
 * @param {string} title
 * @param {string} filename
 * @returns {string}
 */
export function titleFilenameHint(title, filename) {
  if (!projectTitleDiffersFromFileTheme(title, filename)) return '';
  const theme = themeTagFromSnapshotName(filename).replace(/_/g, ' ');
  return theme
    ? `제목 ≠ 파일명 테마(${theme})`
    : '제목 ≠ 파일명';
}
