/** 공통 유틸리티 */

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowIso() {
  return new Date().toISOString();
}

export function padEpisode(num) {
  return `EP${String(num).padStart(3, '0')}`;
}

export function padStory(num) {
  return `ST${String(num).padStart(3, '0')}`;
}

export function parseEpisodeNumber(name) {
  const m = name.match(/EP(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export function parseStoryNumber(name) {
  const m = name.match(/ST(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/** 세계관 설정 문서: NN_NAME.md (2자리 숫자 + 언더스코어) */
export const SETTING_MD_RE = /^(\d{2})_[A-Z0-9_]+\.md$/i;

export function basename(path) {
  return String(path).replace(/^.*[\\/]/, '');
}

export function isSettingMdPath(path) {
  return SETTING_MD_RE.test(basename(path));
}

export function parseSettingMdIndex(path) {
  const m = basename(path).match(/^(\d{2})_/i);
  return m ? parseInt(m[1], 10) : null;
}

export function getSettingMdFiles(cache) {
  return (cache.files || [])
    .filter((f) => isSettingMdPath(f.path))
    .sort((a, b) => parseSettingMdIndex(a.path) - parseSettingMdIndex(b.path));
}

export function findSettingMdFile(cache, pathOrIndex) {
  const docs = getSettingMdFiles(cache);
  if (typeof pathOrIndex === 'number') {
    return docs.find((f) => parseSettingMdIndex(f.path) === pathOrIndex) || null;
  }
  const name = basename(pathOrIndex);
  return docs.find((f) => f.path === pathOrIndex || f.path === name || basename(f.path) === name) || null;
}

/** 업로드 파일명 → setting(00_*) / episode(EP) / story(ST) 분류 */
export function classifyImportFilename(filename) {
  const name = basename(filename);
  const base = name.replace(/\.[^.]+$/, '');
  const ext = name.split('.').pop()?.toLowerCase();

  if (ext === 'md' && /^\d{2}_/i.test(base)) {
    return { type: 'setting', index: parseInt(base.slice(0, 2), 10), path: `${base}.md` };
  }

  const epNum = parseEpisodeNumber(base);
  if (epNum != null) return { type: 'episode', number: epNum };
  const stNum = parseStoryNumber(base);
  if (stNum != null) return { type: 'story', number: stNum };
  return { type: 'story', number: null };
}

export function extractDocTitle(content, fallback = '') {
  const first = (content || '').split('\n').map((l) => l.trim()).find(Boolean);
  if (!first) return fallback;
  const tagged = first.match(/^#\s*(?:ST|EP)\d+[^·\w]*·\s*(.+)$/i);
  if (tagged) return tagged[1].trim();
  if (first.startsWith('# ')) return first.slice(2).trim();
  return fallback || first.slice(0, 80);
}

/** 소설 읽기 제목 — MD 첫 줄 7번째 문자(1-based)부터 추출 (예: Ep006_제6화 → 제6화...) */
export function extractStoryReaderTitle(content, fallback = '') {
  const line = (content || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const cleaned = line.replace(/^#+\s*/, '').trim();
  if (!cleaned) return fallback;

  if (cleaned.length >= 7) {
    const from7 = cleaned.slice(6).trim();
    if (from7) return from7;
  }

  const episode = cleaned.match(/제\d+화.*$/);
  if (episode) return episode[0].trim();

  return fallback || cleaned;
}

/** 소설 읽기 목록 라벨 — "제1화 자막 1초" 형식 */
export function formatStoryReaderLabel(story) {
  const num = story?.number ?? 0;
  const epLabel = `제${num}화`;
  let subtitle = extractStoryReaderTitle(story?.content || '', story?.title || '');
  subtitle = subtitle.replace(/^제\d+화[.\s·]*/, '').trim();
  return subtitle ? `${epLabel} ${subtitle}` : epLabel;
}

export function wordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function simpleMarkdownToHtml(md) {
  const lines = md.split('\n');
  const parts = [];
  let inParagraph = false;

  for (const line of lines) {
    if (line.startsWith('# ')) {
      if (inParagraph) { parts.push('</p>'); inParagraph = false; }
      parts.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.trim() === '') {
      if (inParagraph) { parts.push('</p>'); inParagraph = false; }
    } else {
      if (!inParagraph) {
        parts.push('<p>');
        inParagraph = true;
      } else {
        parts.push('<br>');
      }
      parts.push(escapeHtml(line));
    }
  }
  if (inParagraph) parts.push('</p>');
  return parts.join('');
}

export const FORESHADOW_GRADES = ['F', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
export const FORESHADOW_STATUSES = ['OPEN', 'PROGRESS', 'RESOLVED', 'CANCELLED'];

export function validateForeshadow(data) {
  if (!data.title?.trim()) return '제목은 필수입니다.';
  if (!FORESHADOW_GRADES.includes(data.grade)) return '등급이 올바르지 않습니다.';
  if (!FORESHADOW_STATUSES.includes(data.status)) return '상태가 올바르지 않습니다.';
  return null;
}
