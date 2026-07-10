/** 섹션 XML → 캔버스 HTML 렌더 (뷰별 전용 XML) */

import {
  loadSectionForView,
  resolveAssetUrl,
  parseCharacters,
  parseStories,
  parseForeshadows,
  parseTimeline,
  parseMasterFields,
} from '../core/workspace-xml.js';
import { escapeHtml } from '../core/utils.js';
import * as project from '../core/project.js';
import { openCharacterPanel } from './character-panel.js';
import { on } from '../core/events.js';

/** 인물 XML 카드 클릭용 메타 (id → xml 필드) */
let characterXmlById = new Map();
let characterXmlUrl = '';
let characterActionsBound = false;

/**
 * @param {string} viewId
 * @param {HTMLElement} mountEl
 * @returns {Promise<{ xmlUrl: string, title: string } | null>}
 */
export async function renderSectionCanvas(viewId, mountEl) {
  if (!mountEl) return null;

  mountEl.innerHTML = '<p class="xml-section-loading">섹션 XML 로드 중…</p>';

  let payload;
  try {
    payload = await loadSectionForView(viewId);
  } catch (err) {
    mountEl.innerHTML = `<p class="xml-section-error">XML 로드 실패: ${escapeHtml(err.message)}</p>`;
    return null;
  }

  if (!payload) {
    mountEl.innerHTML = '<p class="xml-section-empty">이 뷰에 연결된 섹션 XML이 없습니다.</p>';
    return null;
  }

  const { meta, doc, xmlUrl } = payload;
  const banner = `
    <div class="xml-section-banner" data-view="${escapeHtml(viewId)}">
      <span class="xml-section-badge">XML</span>
      <code class="xml-section-path">${escapeHtml(shortPath(xmlUrl))}</code>
      <span class="xml-section-title">${escapeHtml(meta.title)}</span>
    </div>`;

  let body = '';
  if (viewId === 'character') body = renderCharacterSection(doc, xmlUrl);
  else if (viewId === 'reader') body = renderReaderSection(doc, xmlUrl);
  else if (viewId === 'foreshadow') body = renderForeshadowSection(doc);
  else if (viewId === 'timeline') body = renderTimelineSection(doc);
  else if (viewId === 'master') body = renderMasterSection(doc, xmlUrl);
  else if (viewId === 'story-bible' || viewId === 'world') body = renderDocSection(doc, xmlUrl);
  else if (viewId === 'story-nav') body = renderStoryNavSection(doc, xmlUrl);
  else body = `<p class="xml-section-note">섹션 <strong>${escapeHtml(meta.id)}</strong> XML이 로드되었습니다.</p>`;

  mountEl.innerHTML = banner + body;
  return { xmlUrl, title: meta.title };
}

function shortPath(url) {
  try {
    const u = new URL(url);
    const i = u.pathname.indexOf('/data/');
    return i >= 0 ? u.pathname.slice(i + 1) : u.pathname;
  } catch {
    return url;
  }
}

function renderCharacterSection(doc, xmlUrl) {
  const list = parseCharacters(doc);
  characterXmlUrl = xmlUrl;
  characterXmlById = new Map(list.map((c) => [c.id, c]));

  if (!list.length) return '<p class="xml-section-empty">인물 없음</p>';

  const cards = list.map((c) => {
    const idb = project.findCharacterByXmlRef(c.id, c.name);
    const avatar = idb?.avatarDataUrl
      || (c.avatarSrc ? resolveAssetUrl(c.avatarSrc, xmlUrl) : '');
    const img = avatar
      ? `<img class="xml-card-img" src="${escapeHtml(avatar)}" alt="">`
      : '<div class="xml-card-img xml-card-img--empty">👤</div>';
    return `
      <article class="xml-card xml-card--character" data-id="${escapeHtml(c.id)}" role="button" tabindex="0" title="클릭하여 PNG 등록">
        ${img}
        <div class="xml-card-body">
          <h3>${escapeHtml(c.name)} <small>${escapeHtml(c.id)}</small></h3>
          <p class="xml-card-meta">${escapeHtml(c.race)} · EP${escapeHtml(c.firstEpisode)}~${escapeHtml(c.lastEpisode)}</p>
          <p>${escapeHtml(c.description)}</p>
          <p class="xml-card-hint">클릭 → 우측에서 PNG 등록</p>
        </div>
      </article>`;
  }).join('');

  return `<div class="xml-card-grid">${cards}</div>`;
}

function renderReaderSection(doc, xmlUrl) {
  const stories = parseStories(doc);
  if (!stories.length) return '<p class="xml-section-empty">소설 목록 없음</p>';

  const rows = stories.map((s) => `
    <button type="button" class="xml-story-row" data-story-src="${escapeHtml(resolveAssetUrl(s.src, xmlUrl))}" data-story-id="${escapeHtml(s.id)}">
      <span class="xml-story-num">제${s.number}화</span>
      <span class="xml-story-title">${escapeHtml(s.title)}</span>
      <code class="xml-story-src">${escapeHtml(s.src.split('/').pop() || s.src)}</code>
    </button>`).join('');

  return `
    <p class="xml-section-note">소설 읽기 전용 XML (<code>10_reader.xml</code>). 행을 누르면 MD를 로드합니다.</p>
    <div class="xml-story-list">${rows}</div>
    <article id="xml-reader-body" class="xml-reader-body" hidden></article>`;
}

function renderForeshadowSection(doc) {
  const list = parseForeshadows(doc);
  const rows = list.map((f) => `
    <div class="xml-fs-row">
      <span class="grade-badge grade-${escapeHtml(f.grade)}">${escapeHtml(f.grade)}</span>
      <strong>${escapeHtml(f.title)}</strong>
      <span class="status-${escapeHtml(f.status)}">${escapeHtml(f.status)}</span>
      <small>EP${escapeHtml(f.createdEpisode)} → EP${escapeHtml(f.expectedEpisode)}</small>
    </div>`).join('');
  return `<div class="xml-fs-list">${rows || '<p class="xml-section-empty">복선 없음</p>'}</div>`;
}

function renderTimelineSection(doc) {
  const list = parseTimeline(doc);
  const rows = list.map((t) => `
    <div class="xml-tl-row">
      <span>EP${escapeHtml(String(t.episode).padStart(3, '0'))}</span>
      <strong>${escapeHtml(t.title)}</strong>
      <small>${escapeHtml(t.date)}</small>
    </div>`).join('');
  return `<div class="xml-tl-list">${rows || '<p class="xml-section-empty">이벤트 없음</p>'}</div>`;
}

function renderMasterSection(doc, xmlUrl) {
  const fields = parseMasterFields(doc);
  const fieldHtml = Object.entries(fields).map(([k, v]) =>
    `<div class="xml-field"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`
  ).join('');
  const docEl = doc.querySelector('Doc');
  const docSrc = docEl?.getAttribute('src') || '';
  return `
    <div class="xml-master-fields">${fieldHtml}</div>
    ${docSrc ? `<p class="xml-section-note">문서: <code>${escapeHtml(docSrc)}</code>
      <button type="button" class="btn-sm" data-xml-doc="${escapeHtml(resolveAssetUrl(docSrc, xmlUrl))}">MD 미리보기</button></p>
      <article id="xml-doc-preview" class="xml-reader-body" hidden></article>` : ''}`;
}

function renderDocSection(doc, xmlUrl) {
  const docs = [...doc.querySelectorAll('Doc')];
  if (!docs.length) return '<p class="xml-section-empty">문서 없음</p>';
  const links = docs.map((d) => {
    const src = d.getAttribute('src') || '';
    const id = d.getAttribute('id') || src.split('/').pop();
    return `<button type="button" class="btn-sm" data-xml-doc="${escapeHtml(resolveAssetUrl(src, xmlUrl))}">${escapeHtml(id)}</button>`;
  }).join(' ');
  return `<div class="xml-doc-actions">${links}</div><article id="xml-doc-preview" class="xml-reader-body" hidden></article>`;
}

function renderStoryNavSection(doc, xmlUrl) {
  const eps = [...doc.querySelectorAll('Episodes > Episode')].map((el) => ({
    id: el.getAttribute('id'),
    number: el.getAttribute('number'),
    title: el.getAttribute('title') || '',
    src: el.getAttribute('src') || '',
  }));
  const rows = eps.map((e) => `
    <div class="xml-tl-row">
      <span>${escapeHtml(e.id)}</span>
      <strong>${escapeHtml(e.title)}</strong>
      <code>${escapeHtml(e.src.split('/').pop() || '')}</code>
    </div>`).join('');
  return `<div class="xml-tl-list">${rows}</div>`;
}

/** 마운트 후 MD 미리보기 / 소설 행 / 인물 카드 클릭 바인딩 */
export function bindSectionCanvasActions(mountEl) {
  if (!mountEl) return;

  mountEl.querySelectorAll('[data-xml-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-xml-doc');
      const preview = mountEl.querySelector('#xml-doc-preview');
      if (!preview || !url) return;
      preview.hidden = false;
      preview.textContent = '불러오는 중…';
      try {
        const res = await fetch(url);
        preview.textContent = await res.text();
      } catch (err) {
        preview.textContent = `로드 실패: ${err.message}`;
      }
    });
  });

  mountEl.querySelectorAll('.xml-story-row').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-story-src');
      let body = mountEl.querySelector('#xml-reader-body');
      if (!body) {
        body = document.createElement('article');
        body.id = 'xml-reader-body';
        body.className = 'xml-reader-body';
        mountEl.appendChild(body);
      }
      body.hidden = false;
      body.textContent = '불러오는 중…';
      mountEl.querySelectorAll('.xml-story-row').forEach((r) => r.classList.remove('active'));
      btn.classList.add('active');
      try {
        const res = await fetch(url);
        body.textContent = await res.text();
      } catch (err) {
        body.textContent = `로드 실패: ${err.message}`;
      }
    });
  });

  bindCharacterCardActions(mountEl);
}

function bindCharacterCardActions(mountEl) {
  mountEl.querySelectorAll('.xml-card--character').forEach((card) => {
    const activate = () => openXmlCharacter(card.dataset.id, mountEl);
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });

  if (!characterActionsBound) {
    characterActionsBound = true;
    on('character:updated', (ch) => {
      const root = document.getElementById('xml-section-root');
      if (!root || !ch) return;
      const xmlId = ch.characterId || String(ch.id).split('-').pop();
      const card = root.querySelector(`.xml-card--character[data-id="${cssEscape(xmlId)}"]`);
      if (!card || !ch.avatarDataUrl) return;
      let img = card.querySelector('img.xml-card-img');
      if (!img) {
        const empty = card.querySelector('.xml-card-img--empty');
        img = document.createElement('img');
        img.className = 'xml-card-img';
        empty?.replaceWith(img);
      }
      if (img) img.src = ch.avatarDataUrl;
    });
  }
}

async function openXmlCharacter(xmlId, mountEl) {
  const xmlChar = characterXmlById.get(xmlId);
  if (!xmlChar) return;

  const record = await project.ensureCharacterFromXml(xmlChar);
  if (!record) {
    console.warn('[section-canvas] 인물 IndexedDB 동기화 실패', xmlId);
    return;
  }

  mountEl.querySelectorAll('.xml-card--character').forEach((c) => {
    c.classList.toggle('is-selected', c.dataset.id === xmlId);
  });

  await openCharacterPanel(record);
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}
