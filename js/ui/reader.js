/** 리더 패널 — Q4=B: 기존 UI + 10_reader.xml 데이터 */

import { on, emit } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { simpleMarkdownToHtml, formatStoryReaderLabel } from '../core/utils.js';
import { showDialog } from './dialog.js';
import { canUpload } from '../core/auth.js';
import {
  loadSectionForView,
  resolveAssetUrl,
  parseStories,
} from '../core/workspace-xml.js';

const LIST_VISIBLE_ROWS = 10;

/** @type {Array<{ id: string, number: number, title: string, src: string, content?: string, source: 'xml'|'idb' }>} */
let catalog = [];
let currentStoryNum = null;
let readerXmlUrl = '';

export function initReader() {
  const select = document.getElementById('reader-episode-select');
  const content = document.getElementById('reader-content');
  const fontSlider = document.getElementById('reader-font-size');

  initScrollableSelect(select);

  on('project:loaded', () => refreshReader());
  on('workspace:render', (viewId) => {
    if (viewId === 'reader') refreshReader();
  });
  on('view:changed', (viewId) => {
    if (viewId === 'reader') refreshReader();
  });

  select?.addEventListener('change', () => {
    showStory(parseInt(select.value, 10), content);
  });

  fontSlider?.addEventListener('input', () => {
    if (content) content.style.fontSize = `${fontSlider.value}px`;
  });

  document.querySelector('[data-action="prev-episode"]')?.addEventListener('click', () => {
    const idx = catalog.findIndex((s) => s.number === currentStoryNum);
    if (idx > 0) showStory(catalog[idx - 1].number, content, select);
  });

  document.querySelector('[data-action="next-episode"]')?.addEventListener('click', () => {
    const idx = catalog.findIndex((s) => s.number === currentStoryNum);
    if (idx >= 0 && idx < catalog.length - 1) showStory(catalog[idx + 1].number, content, select);
  });

  document.querySelector('[data-action="delete-story"]')?.addEventListener('click', () => {
    deleteCurrentStory();
  });

  document.querySelector('[data-action="delete-all-stories"]')?.addEventListener('click', () => {
    deleteAllStories();
  });
}

function initScrollableSelect(select) {
  if (!select) return;

  const collapse = () => {
    select.size = 1;
    select.classList.remove('is-expanded');
  };

  select.addEventListener('mousedown', () => {
    if (select.disabled) return;
    const count = select.options.length;
    select.size = Math.min(LIST_VISIBLE_ROWS, Math.max(1, count));
    select.classList.add('is-expanded');
  });

  select.addEventListener('blur', () => {
    setTimeout(collapse, 120);
  });

  select.addEventListener('change', collapse);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && select.classList.contains('is-expanded')) {
      collapse();
      select.blur();
    }
  });
}

export async function refreshReader() {
  const select = document.getElementById('reader-episode-select');
  const content = document.getElementById('reader-content');

  catalog = await buildCatalog();
  populateSelect(select, catalog);
  updateReaderNavState(catalog);

  if (!catalog.length) {
    currentStoryNum = null;
    if (content) {
      content.innerHTML = '<p class="inspector-empty">읽을 소설이 없습니다.<br><code>10_reader.xml</code> 또는 ST*.md 업로드를 확인하세요.</p>';
    }
    return;
  }

  const keep = catalog.some((s) => s.number === currentStoryNum);
  const num = keep ? currentStoryNum : catalog[0].number;
  await showStory(num, content, select);
}

async function buildCatalog() {
  const fromXml = await loadXmlStories();
  const fromIdb = project.getRegisteredStories().map((s) => ({
    id: s.storyId || s.id,
    number: Number(s.number),
    title: s.title || '',
    src: '',
    content: s.content || '',
    source: 'idb',
  }));

  // DB 소설을 우선 넣고, XML에만 있는 화는 뒤에 보강 (XML 파일은 변경하지 않음)
  const byNum = new Map();
  for (const s of fromIdb) byNum.set(s.number, s);
  for (const s of fromXml) {
    const existing = byNum.get(s.number);
    if (existing) {
      byNum.set(s.number, {
        ...s,
        title: existing.title || s.title,
        content: existing.content,
        source: 'overlay',
      });
    } else {
      byNum.set(s.number, s);
    }
  }

  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

async function loadXmlStories() {
  try {
    const payload = await loadSectionForView('reader');
    if (!payload?.doc) return [];
    readerXmlUrl = payload.xmlUrl;
    return parseStories(payload.doc).map((s) => ({
      ...s,
      content: undefined,
      source: 'xml',
    }));
  } catch (err) {
    console.warn('[reader] XML 로드 실패, IndexedDB만 사용:', err.message);
    return [];
  }
}

function populateSelect(select, stories) {
  if (!select) return;
  if (!stories.length) {
    select.innerHTML = '<option value="">소설 없음</option>';
    select.disabled = true;
    select.size = 1;
    return;
  }
  select.disabled = false;
  select.size = 1;
  select.innerHTML = stories.map((s) => {
    let label;
    if (s.source === 'idb') label = formatStoryReaderLabel(s);
    else if (s.source === 'overlay') label = `제${s.number}화 ${s.title} (로컬)`.trim();
    else label = `제${s.number}화 ${s.title}`.trim();
    return `<option value="${s.number}">${escapeHtml(label)}</option>`;
  }).join('');
}

function updateReaderNavState(stories) {
  const hasStories = stories.length > 0;
  const current = stories.find((s) => s.number === currentStoryNum);
  const allowDelete = canUpload();
  const canDelete = allowDelete && hasStories && (current?.source === 'idb' || current?.source === 'overlay');

  document.querySelector('[data-action="prev-episode"]')?.toggleAttribute('disabled', !hasStories);
  document.querySelector('[data-action="next-episode"]')?.toggleAttribute('disabled', !hasStories);

  const delBtn = document.querySelector('[data-action="delete-story"]');
  const delAllBtn = document.querySelector('[data-action="delete-all-stories"]');
  if (delBtn) {
    delBtn.hidden = !allowDelete;
    delBtn.toggleAttribute('disabled', !canDelete);
  }
  if (delAllBtn) {
    delAllBtn.hidden = !allowDelete;
    delAllBtn.toggleAttribute(
      'disabled',
      !allowDelete || !stories.some((s) => s.source === 'idb' || s.source === 'overlay')
    );
  }
}

export async function showStory(num, contentEl, selectEl) {
  const entry = catalog.find((s) => s.number === num);
  if (!entry || !contentEl) return;

  currentStoryNum = num;
  if (selectEl) selectEl.value = String(num);
  else {
    const sel = document.getElementById('reader-episode-select');
    if (sel) sel.value = String(num);
  }

  contentEl.innerHTML = '<p class="inspector-empty">불러오는 중…</p>';
  updateReaderNavState(catalog);

  try {
    const markdown = await resolveStoryContent(entry);
    contentEl.innerHTML = `<div class="reader-inner">${simpleMarkdownToHtml(markdown)}</div>`;
  } catch (err) {
    contentEl.innerHTML = `<p class="inspector-empty">로드 실패: ${escapeHtml(err.message)}</p>`;
  }
}

async function resolveStoryContent(entry) {
  // 로컬 DB / 오버레이는 IndexedDB 본문 우선 (XML 파일은 변경하지 않음)
  if (entry.source === 'idb' || entry.source === 'overlay') {
    return entry.content
      || project.getStoryByNumber(entry.number)?.content
      || '';
  }

  const url = resolveAssetUrl(entry.src, readerXmlUrl);
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${entry.src} (${res.status})`);
    entry.content = await res.text();
    return entry.content;
  } catch (err) {
    const fallback = project.getStoryByNumber(entry.number)?.content || '';
    if (fallback) return fallback;
    throw err;
  }
}

export function getCurrentStoryNumber() {
  return currentStoryNum;
}

async function deleteCurrentStory() {
  if (!canUpload()) {
    alert('일반 사용자는 소설을 삭제할 수 없습니다.');
    return;
  }
  const entry = catalog.find((s) => s.number === currentStoryNum);
  if (!entry || (entry.source !== 'idb' && entry.source !== 'overlay')) {
    await showDialog({
      title: '삭제 불가',
      bodyHtml: '<p>XML 원본(<code>10_reader.xml</code>)은 앱에서 수정·삭제하지 않습니다.<br>IndexedDB에 올린 로컬 소설(또는 로컬 오버레이)만 삭제됩니다.</p>',
      onConfirm: null,
    });
    return;
  }

  await project.deleteStory(currentStoryNum);
  autosave.markDirty();
  emit('project:loaded', project.getCurrentProject());
}

async function deleteAllStories() {
  if (!canUpload()) {
    alert('일반 사용자는 소설을 삭제할 수 없습니다.');
    return;
  }
  const idbStories = catalog.filter((s) => s.source === 'idb' || s.source === 'overlay');
  if (!idbStories.length) {
    await showDialog({
      title: '삭제 불가',
      bodyHtml: '<p>IndexedDB에 업로드된 소설이 없습니다. XML 시드는 삭제되지 않습니다.</p>',
      onConfirm: null,
    });
    return;
  }

  const ok = await showDialog({
    title: '전체 소설 삭제',
    bodyHtml: `<p>IndexedDB 로컬 소설 <strong>${idbStories.length}개</strong>를 삭제합니다.<br>XML(<code>10_reader.xml</code>)은 그대로 유지됩니다.</p>`,
  });
  if (!ok) return;

  await project.deleteAllStories();
  autosave.markDirty();
  emit('project:loaded', project.getCurrentProject());
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
