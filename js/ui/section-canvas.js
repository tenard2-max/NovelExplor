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
import { formatSummaryLineBreaks } from '../core/story-sync-engine.js';

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

  let payload = null;
  try {
    payload = await loadSectionForView(viewId);
  } catch (err) {
    // 타임라인·스토리 네비는 IndexedDB만으로도 표시 가능
    if (viewId !== 'timeline' && viewId !== 'story-nav') {
      mountEl.innerHTML = `<p class="xml-section-error">XML 로드 실패: ${escapeHtml(err.message)}</p>`;
      return null;
    }
  }

  if (!payload && viewId !== 'timeline' && viewId !== 'story-nav') {
    mountEl.innerHTML = '<p class="xml-section-empty">이 뷰에 연결된 섹션 XML이 없습니다.</p>';
    return null;
  }

  const meta = payload?.meta || {
    id: viewId,
    title: viewId === 'timeline' ? '타임라인' : '스토리 네비',
  };
  const doc = payload?.doc || null;
  const xmlUrl = payload?.xmlUrl || '';
  const banner = `
    <div class="xml-section-banner" data-view="${escapeHtml(viewId)}">
      <span class="xml-section-badge">${xmlUrl ? 'XML' : 'IDB'}</span>
      <code class="xml-section-path">${escapeHtml(xmlUrl ? shortPath(xmlUrl) : 'IndexedDB')}</code>
      <span class="xml-section-title">${escapeHtml(meta.title)}</span>
    </div>`;

  let body = '';
  if (viewId === 'character') body = renderCharacterSection(doc, xmlUrl);
  else if (viewId === 'reader') body = renderReaderSection(doc, xmlUrl);
  else if (viewId === 'foreshadow') body = renderForeshadowSection(doc);
  else if (viewId === 'timeline') body = renderTimelineSectionFromIdb(doc);
  else if (viewId === 'master') body = renderMasterSection(doc, xmlUrl);
  else if (viewId === 'story-bible' || viewId === 'world') body = renderDocSection(doc, xmlUrl);
  else if (viewId === 'story-nav') body = renderStoryNavSectionFromIdb(doc, xmlUrl);
  else body = `<p class="xml-section-note">섹션 <strong>${escapeHtml(meta.id)}</strong> XML이 로드되었습니다.</p>`;

  const sourceNote = (viewId === 'timeline' || viewId === 'story-nav')
    ? '<p class="xml-section-note">IndexedDB 기준 표시 · 스토리 동기화 시 XML도 자동 재생성됩니다.</p>'
    : '';
  mountEl.innerHTML = banner + sourceNote + body;
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
  const xmlList = parseCharacters(doc);
  characterXmlUrl = xmlUrl;
  const idbChars = project.getCache().characters || [];

  // DB가 있으면 DB 기준으로 카드를 만들고, XML은 폴백·미등록 인물 보강용
  const matchedXmlIds = new Set();
  let list = [];

  if (idbChars.length) {
    list = idbChars.map((idb) => {
      const cid = idb.characterId || String(idb.id).split('-').pop();
      const xmlChar = xmlList.find((x) => x.id === cid)
        || xmlList.find((x) => x.name && x.name === idb.name)
        || { id: cid };
      if (xmlChar.id) matchedXmlIds.add(xmlChar.id);
      return mergeCharacterDisplay(xmlChar, idb, xmlUrl);
    });

    for (const xmlChar of xmlList) {
      if (matchedXmlIds.has(xmlChar.id)) continue;
      list.push(mergeCharacterDisplay(xmlChar, null, xmlUrl));
    }
  } else {
    list = xmlList.map((xmlChar) => mergeCharacterDisplay(xmlChar, null, xmlUrl));
  }

  characterXmlById = new Map(list.map((c) => [c.id, c]));
  if (!list.length) return '<p class="xml-section-empty">인물 없음</p>';

  const cards = list.map((c) => {
    const img = c.avatarUrl
      ? `<img class="xml-card-img" src="${escapeHtml(c.avatarUrl)}" alt="">`
      : '<div class="xml-card-img xml-card-img--empty">👤</div>';
    const localTag = c.isLocal ? '<span class="xml-card-local">로컬</span>' : '';
    return `
      <article class="xml-card xml-card--character" data-id="${escapeHtml(c.id)}" role="button" tabindex="0" title="클릭하여 PNG 등록">
        ${img}
        <div class="xml-card-body">
          <h3>${escapeHtml(c.name)} <small>${escapeHtml(c.id)}</small> ${localTag}</h3>
          <p class="xml-card-meta">${escapeHtml(c.race)} · EP${escapeHtml(String(c.firstEpisode))}~${escapeHtml(String(c.lastEpisode))}</p>
          <p>${escapeHtml(c.description)}</p>
          <p class="xml-card-hint">클릭 → 우측에서 PNG 등록 (화면은 DB 우선)</p>
        </div>
      </article>`;
  }).join('');

  return `<div class="xml-card-grid">${cards}</div>`;
}

/**
 * 화면용 인물 병합: IndexedDB가 있으면 텍스트·이미지 모두 DB 우선, XML은 폴백.
 * @param {object} xmlChar
 * @param {object | null} idb
 * @param {string} xmlUrl
 */
export function mergeCharacterDisplay(xmlChar, idb, xmlUrl = '') {
  const id = (idb?.characterId || xmlChar?.id || String(idb?.id || '').split('-').pop() || '');
  const pick = (idbVal, xmlVal) => {
    if (idbVal !== undefined && idbVal !== null && String(idbVal).trim() !== '') return idbVal;
    return xmlVal ?? '';
  };

  const name = String(pick(idb?.name, xmlChar?.name) || '');
  const race = String(pick(idb?.race, xmlChar?.race) || '');
  const description = String(pick(idb?.description, xmlChar?.description) || '');
  const firstEpisode = String(pick(idb?.firstEpisode, xmlChar?.firstEpisode) || '');
  const lastEpisode = String(pick(idb?.lastEpisode, xmlChar?.lastEpisode) || '');
  const gender = String(pick(idb?.gender, xmlChar?.gender) || '');
  const age = String(pick(idb?.age, xmlChar?.age) || '');
  const occupation = String(pick(idb?.occupation, xmlChar?.occupation) || '');
  const status = String(pick(idb?.status, xmlChar?.status) || '');

  const dbAvatar = idb?.avatarDataUrl
    || idb?.image
    || idb?.avatar
    || idb?.avatarUrl
    || (Array.isArray(idb?.images) && idb.images[0])
    || '';
  const avatarUrl = dbAvatar
    || (xmlChar?.avatarSrc && xmlUrl ? resolveAssetUrl(xmlChar.avatarSrc, xmlUrl) : '')
    || (xmlChar?.avatarUrl || '');

  const xmlSnapshot = xmlChar?.xmlSnapshot || {
    name: xmlChar?.name || '',
    race: xmlChar?.race || '',
    description: xmlChar?.description || '',
  };

  const hasDbMedia = Boolean(dbAvatar);
  const textDiffers = Boolean(idb) && (
    (idb.name && idb.name !== xmlSnapshot.name)
    || (idb.description && idb.description !== xmlSnapshot.description)
    || (idb.race && idb.race !== xmlSnapshot.race)
    || hasDbMedia
  );

  return {
    id,
    name,
    race,
    gender,
    age,
    occupation,
    firstEpisode,
    lastEpisode,
    status,
    description,
    avatarSrc: xmlChar?.avatarSrc || '',
    avatarUrl,
    xmlSnapshot,
    fromIdb: Boolean(idb),
    isLocal: Boolean(idb) && (textDiffers || hasDbMedia || !xmlSnapshot.name),
    xmlId: xmlChar?.xmlId || xmlChar?.id || id,
  };
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

/** 타임라인: IndexedDB 우선, 없으면 XML 폴백 */
function renderTimelineSectionFromIdb(doc) {
  const idb = [...(project.getCache().timeline || [])]
    .sort((a, b) => (a.episode - b.episode) || String(a.title).localeCompare(String(b.title)));
  if (idb.length) {
    const rows = idb.map((t) => `
      <article class="xml-tl-row xml-tl-row--rich">
        <div class="xml-tl-row-main">
          <span>EP${escapeHtml(String(t.episode).padStart(3, '0'))}</span>
          <strong>${escapeHtml(t.title)}</strong>
          <small>${escapeHtml(t.source === 'story-sync' ? (t.keywords || []).join('·') : (t.date || ''))}</small>
        </div>
        ${t.description ? `<p class="xml-tl-desc">${escapeHtml(t.description)}</p>` : ''}
      </article>`).join('');
    return `<div class="xml-tl-list">${rows}</div>`;
  }
  if (doc) return renderTimelineSection(doc);
  return '<p class="xml-section-empty">이벤트 없음 · 상단 「타임라인 업데이트」로 생성할 수 있습니다.</p>';
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

/** 스토리 네비: IndexedDB episodes 우선 · 클릭 시 요약 펼침 */
function renderStoryNavSectionFromIdb(doc, xmlUrl) {
  const eps = [...(project.getCache().episodes || [])].sort((a, b) => a.number - b.number);
  if (eps.length) {
    const rows = eps.map((e) => {
      const rawSummary = e.summary
        || (e.content ? String(e.content).replace(/\s+/g, ' ').trim().slice(0, 280) : '')
        || '요약 없음 · 「네비 업데이트」를 실행하세요.';
      const summary = formatSummaryLineBreaks(rawSummary);
      return `
      <article class="xml-nav-ep" data-ep-id="${escapeHtml(e.id)}" tabindex="0" role="button"
               aria-expanded="false" title="클릭하여 요약 보기">
        <div class="xml-tl-row xml-nav-ep-head">
          <span>EP${escapeHtml(String(e.number).padStart(3, '0'))}</span>
          <strong>${escapeHtml(e.title || '')}</strong>
          <code>${escapeHtml(e.textFile || '')}</code>
        </div>
        <div class="xml-nav-ep-summary" hidden>
          <p>${escapeHtml(summary)}</p>
        </div>
      </article>`;
    }).join('');
    return `<div class="xml-tl-list xml-nav-list">${rows}</div>`;
  }
  if (doc) return renderStoryNavSection(doc, xmlUrl);
  return '<p class="xml-section-empty">에피소드 없음 · ST 업로드 후 「네비 업데이트」를 실행하세요.</p>';
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

  mountEl.querySelectorAll('.xml-nav-ep').forEach((row) => {
    const toggle = () => {
      const open = row.getAttribute('aria-expanded') === 'true';
      const next = !open;
      row.setAttribute('aria-expanded', String(next));
      row.classList.toggle('is-open', next);
      const summary = row.querySelector('.xml-nav-ep-summary');
      if (summary) summary.hidden = !next;
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
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
      patchCharacterCard(root, ch);
    });
  }
}

/** DB 갱신 직후 카드 텍스트·이미지를 즉시 반영 */
function patchCharacterCard(root, ch) {
  const xmlId = ch.characterId || String(ch.id).split('-').pop();
  const card = root.querySelector(`.xml-card--character[data-id="${cssEscape(xmlId)}"]`);
  if (!card) return;

  const merged = mergeCharacterDisplay(
    characterXmlById.get(xmlId) || { id: xmlId },
    ch,
    characterXmlUrl
  );
  characterXmlById.set(xmlId, merged);

  const title = card.querySelector('h3');
  if (title) {
    const local = merged.isLocal ? ' <span class="xml-card-local">로컬</span>' : '';
    title.innerHTML = `${escapeHtml(merged.name)} <small>${escapeHtml(merged.id)}</small>${local}`;
  }
  const meta = card.querySelector('.xml-card-meta');
  if (meta) {
    meta.textContent = `${merged.race} · EP${merged.firstEpisode}~${merged.lastEpisode}`;
  }
  const desc = card.querySelector('.xml-card-body > p:not(.xml-card-meta):not(.xml-card-hint)');
  if (desc) desc.textContent = merged.description;

  if (merged.avatarUrl) {
    let img = card.querySelector('img.xml-card-img');
    if (!img) {
      const empty = card.querySelector('.xml-card-img--empty');
      img = document.createElement('img');
      img.className = 'xml-card-img';
      empty?.replaceWith(img);
    }
    if (img) img.src = merged.avatarUrl;
  } else {
    const img = card.querySelector('img.xml-card-img');
    if (img) {
      const empty = document.createElement('div');
      empty.className = 'xml-card-img xml-card-img--empty';
      empty.textContent = '👤';
      img.replaceWith(empty);
    }
  }
}

async function openXmlCharacter(xmlId, mountEl) {
  const display = characterXmlById.get(xmlId);
  if (!display) return;

  // ensure에는 XML id 기준으로 조회 (표시용 병합 객체도 id 동일)
  const record = await project.ensureCharacterFromXml({
    id: display.xmlId || display.id,
    name: display.name,
    race: display.race,
    gender: display.gender,
    age: display.age,
    occupation: display.occupation,
    firstEpisode: display.firstEpisode,
    lastEpisode: display.lastEpisode,
    status: display.status,
    description: display.description,
  });
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
