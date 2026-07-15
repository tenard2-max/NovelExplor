/** 인물 이미지 URL 해석 — data URL · 정적 overlay 경로 공통 처리 */

/** @param {string} src */
export function resolveMediaSrc(src) {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (
    raw.startsWith('data:')
    || raw.startsWith('blob:')
    || /^https?:\/\//i.test(raw)
    || raw.startsWith('/')
  ) {
    return raw;
  }
  try {
    return new URL(raw.replace(/^\.\//, ''), document.baseURI || location.href).href;
  } catch {
    return raw;
  }
}

/** 대표 이미지 표시 URL (로컬 data URL 우선, 없으면 avatarPath 등) */
export function getCharacterRepresentativeUrl(ch) {
  if (!ch) return '';
  const fromData = String(
    ch.avatarDataUrl || ch.image || ch.avatar || ch.avatarUrl || ch.photo || ''
  ).trim();
  if (fromData) return resolveMediaSrc(fromData);

  const pathLike = String(ch.avatarPath || '').trim()
    || (Array.isArray(ch.imagePaths)
      ? String(ch.imagePaths.find((u) => String(u || '').trim()) || '').trim()
      : '');
  if (pathLike) return resolveMediaSrc(pathLike);

  const first = Array.isArray(ch.images)
    ? String(ch.images.find((u) => String(u || '').trim()) || '').trim()
    : '';
  return resolveMediaSrc(first);
}

/**
 * 갤러리 표시용 항목.
 * - local: IndexedDB images[] (추가·삭제 가능)
 * - path: GitHub/정적 overlay (보기·대표지정만, 목록에서 파일 삭제 아님)
 * @returns {Array<{ url: string, raw: string, kind: 'local'|'path', localIndex: number }>}
 */
export function listCharacterGalleryEntries(ch) {
  if (!ch) return [];
  const entries = [];
  const seen = new Set();

  const push = (raw, kind, localIndex = -1) => {
    const resolved = resolveMediaSrc(raw);
    if (!resolved) return;
    const key = resolved.split('?')[0];
    if (seen.has(key) || seen.has(raw)) return;
    seen.add(key);
    seen.add(raw);
    entries.push({ url: resolved, raw: String(raw), kind, localIndex });
  };

  const images = Array.isArray(ch.images) ? ch.images : [];
  images.forEach((u, i) => {
    if (String(u || '').trim()) push(u, 'local', i);
  });

  const avatarPath = String(ch.avatarPath || '').trim();
  if (avatarPath) push(avatarPath, 'path');

  if (Array.isArray(ch.imagePaths)) {
    for (const p of ch.imagePaths) {
      if (String(p || '').trim()) push(p, 'path');
    }
  }

  return entries;
}
