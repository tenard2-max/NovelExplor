/** 마크다운 → 대시보드 렌더링 */

import { simpleMarkdownToHtml } from '../core/utils.js';

/** 00_MASTER.md 키-값 파싱 */
export function parseMasterFields(content) {
  const fields = {};
  for (const line of (content || '').split('\n')) {
    const m = line.match(/^-\s*([^:]+):\s*(.+)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

/** 마스터 DB 대시보드 */
export function renderMasterDashboard(file, cache, proj) {
  const fields = parseMasterFields(file?.content);
  const title = fields.Title || proj?.title || '프로젝트';
  const epCount = cache.episodes?.length || 0;
  const fsOpen = cache.foreshadows?.filter((f) => f.status === 'OPEN' || f.status === 'PROGRESS').length || 0;
  const fsTotal = cache.foreshadows?.length || 0;
  const charCount = cache.characters?.length || 0;

  const episodes = cache.episodes || [];
  const maxEp = 100;
  const progress = Math.round((epCount / maxEp) * 100);

  return `
    <div class="master-dashboard">
      <header class="dash-hero">
        <div class="dash-hero-text">
          <span class="dash-label">00_MASTER</span>
          <h2 class="dash-title">${esc(title)}</h2>
          <p class="dash-desc">판타지 복선 관리 프로젝트 · ${esc(fields['Story Status'] || `EP001~EP${String(epCount).padStart(3, '0')}`)}</p>
        </div>
        <button class="btn-sm dash-edit-btn" data-open-file="${file?.id || ''}">에디터에서 열기</button>
      </header>

      <div class="dash-stats">
        <div class="stat-card">
          <span class="stat-label">시작 시점</span>
          <strong class="stat-value">${esc(fields['Timeline Start'] || '—')}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">원래 시간</span>
          <strong class="stat-value">${esc(fields['Original Timeline'] || '—')}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">에피소드</span>
          <strong class="stat-value">${epCount}화</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">미회수 복선</span>
          <strong class="stat-value stat-warn">${fsOpen} / ${fsTotal}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">등장인물</span>
          <strong class="stat-value">${charCount}명</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">진행률</span>
          <strong class="stat-value">${progress}%</strong>
        </div>
      </div>

      <div class="dash-progress">
        <div class="dash-progress-header">
          <span>연재 진행</span>
          <span>${epCount} / ${maxEp}화</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      </div>

      <section class="dash-section">
        <h3 class="dash-section-title">에피소드 체크리스트</h3>
        <div class="ep-checklist">
          ${episodes.map((ep) => `
            <button class="ep-chip" data-ep-num="${ep.number}" title="${esc(ep.title)}">
              <span class="ep-chip-num">EP${String(ep.number).padStart(3, '0')}</span>
              <span class="ep-chip-title">${esc(ep.title)}</span>
            </button>
          `).join('')}
        </div>
      </section>

      <section class="dash-section">
        <h3 class="dash-section-title">복선 요약 (등급별)</h3>
        <div class="grade-summary">
          ${gradeSummary(cache.foreshadows)}
        </div>
      </section>
    </div>
  `;
}

/** Story Bible 렌더 */
export function renderStoryBibleView(file) {
  return renderSettingMdView(file, { label: '01_STORY_BIBLE', title: 'Story Bible' });
}

/** 세계관 설정 MD 단일 문서 */
export function renderSettingMdView(file, meta = {}) {
  const path = file?.path || '00_SETTING.md';
  const label = meta.label || path.replace(/\.md$/i, '');
  const title = meta.title || label.replace(/^\d{2}_/, '').replace(/_/g, ' ');
  const body = (file?.content || '').replace(/^#\s*.+\n*/m, '').trim();
  return `
    <div class="bible-view setting-md-view">
      <header class="dash-hero dash-hero-sm">
        <div class="dash-hero-text">
          <span class="dash-label">${esc(label)}</span>
          <h2 class="dash-title">${esc(title)}</h2>
        </div>
        <button class="btn-sm dash-edit-btn" data-open-file="${file?.id || ''}">에디터에서 열기</button>
      </header>
      <div class="bible-body md-rendered">${simpleMarkdownToHtml(body || '내용 없음')}</div>
    </div>
  `;
}

/** 세계관 — 00_*.md 문서 브라우저 */
export function renderSettingDocsWorkspace(docs, selected) {
  const selectedId = selected?.id || '';
  return `
    <div class="setting-docs-workspace">
      <header class="dash-hero dash-hero-sm">
        <div class="dash-hero-text">
          <span class="dash-label">세계관 설정</span>
          <h2 class="dash-title">00_*.md 문서</h2>
          <p class="dash-desc">2자리 숫자 + 언더스코어 형식의 설정 MD · ${docs.length}개</p>
        </div>
      </header>
      <div class="setting-doc-grid">
        ${docs.length ? docs.map((f) => {
          const num = String(f.path.match(/^(\d{2})/)?.[1] || '00');
          const active = f.id === selectedId ? ' active' : '';
          return `
            <button class="setting-doc-card${active}" data-file-id="${f.id}" type="button">
              <span class="setting-doc-num">${num}</span>
              <span class="setting-doc-name">${esc(f.path)}</span>
            </button>`;
        }).join('') : '<p class="inspector-empty">00_NAME.md 형식의 설정 문서가 없습니다. 우측에서 업로드하세요.</p>'}
      </div>
      <div id="setting-doc-preview" class="setting-doc-preview">
        ${selected ? renderSettingMdView(selected) : ''}
      </div>
    </div>
  `;
}

function gradeSummary(foreshadows = []) {
  const grades = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'F'];
  const counts = {};
  for (const g of grades) counts[g] = 0;
  for (const f of foreshadows) counts[f.grade] = (counts[f.grade] || 0) + 1;

  return grades.map((g) => {
    const n = counts[g] || 0;
    if (!n) return '';
    return `<span class="grade-chip grade-${g}">${g} × ${n}</span>`;
  }).filter(Boolean).join('') || '<span class="inspector-empty">복선 없음</span>';
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
