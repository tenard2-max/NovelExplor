/** 리더 패널 — Q4=B: 기존 UI + 10_reader.xml 데이터 */

import { on, emit } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { simpleMarkdownToHtml, formatStoryReaderLabel } from '../core/utils.js';
import { showDialog } from './dialog.js';

const LIST_VISIBLE_ROWS = 10;

/** @type {Array<{ id: string, number: number, title: string, src: string, content?: string, source: 'xml'|'idb' }>} */
let catalog = [];
let currentStoryNum = null;
let isEditingContent = false;

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
    const size = `${fontSlider.value}px`;
    if (content) content.style.fontSize = size;
    document.getElementById('reader-edit-textarea')?.style.setProperty('font-size', size);
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

  document.querySelector('[data-action="edit-story-content"]')?.addEventListener('click', () => {
    startContentEdit();
  });

  document.querySelector('[data-action="save-story-content"]')?.addEventListener('click', () => {
    saveContentEdit();
  });

  document.querySelector('[data-action="cancel-story-content"]')?.addEventListener('click', () => {
    cancelContentEdit();
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

  isEditingContent = false;
  content?.classList.remove('is-editing');

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
  // 프로젝트 격리: 현재 프로젝트 IndexedDB 소설만 (공유 reader XML 미포함)
  return project.getRegisteredStories().map((s) => ({
    id: s.storyId || s.id,
    number: Number(s.number),
    title: s.title || '',
    src: '',
    content: s.content || '',
    source: 'idb',
  })).sort((a, b) => a.number - b.number);
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
  const allowDelete = project.canManageCurrentProject();
  const canDelete = allowDelete && hasStories && (current?.source === 'idb' || current?.source === 'overlay');
  const canEdit = allowDelete && hasStories && current?.source === 'idb' && !isEditingContent;

  document.querySelector('[data-action="prev-episode"]')?.toggleAttribute('disabled', !hasStories || isEditingContent);
  document.querySelector('[data-action="next-episode"]')?.toggleAttribute('disabled', !hasStories || isEditingContent);
  document.getElementById('reader-episode-select')?.toggleAttribute('disabled', !hasStories || isEditingContent);

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

  const editBtn = document.querySelector('[data-action="edit-story-content"]');
  const saveBtn = document.querySelector('[data-action="save-story-content"]');
  const cancelBtn = document.querySelector('[data-action="cancel-story-content"]');
  if (editBtn) {
    editBtn.hidden = !allowDelete || isEditingContent;
    editBtn.toggleAttribute('disabled', !canEdit);
  }
  if (saveBtn) saveBtn.hidden = !isEditingContent;
  if (cancelBtn) cancelBtn.hidden = !isEditingContent;
}

export async function showStory(num, contentEl, selectEl) {
  const entry = catalog.find((s) => s.number === num);
  if (!entry || !contentEl) return;

  if (isEditingContent && num !== currentStoryNum) {
    isEditingContent = false;
    contentEl.classList.remove('is-editing');
  }

  currentStoryNum = num;
  emit('reader:story-changed', { number: num });
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
    tagReaderBlocksForTts(contentEl.querySelector('.reader-inner'));
  } catch (err) {
    contentEl.innerHTML = `<p class="inspector-empty">로드 실패: ${escapeHtml(err.message)}</p>`;
  }
}

function resolveStoryContentSync(entry) {
  return entry.content
    || project.getStoryByNumber(entry.number)?.content
    || '';
}

async function resolveStoryContent(entry) {
  return resolveStoryContentSync(entry);
}

export function getCurrentStoryNumber() {
  return currentStoryNum;
}

export function getCurrentStoryMarkdownSync() {
  const entry = catalog.find((s) => s.number === currentStoryNum);
  if (!entry) return '';
  return resolveStoryContentSync(entry);
}

export async function getCurrentStoryMarkdown() {
  const entry = catalog.find((s) => s.number === currentStoryNum);
  if (!entry) return '';
  return resolveStoryContent(entry);
}

async function startContentEdit() {
  if (!project.canManageCurrentProject()) {
    alert('이 프로젝트의 소설은 소유 관리자 또는 마스터만 수정할 수 있습니다.');
    return;
  }
  const entry = catalog.find((s) => s.number === currentStoryNum);
  if (!entry || entry.source !== 'idb') {
    await showDialog({
      title: '수정 불가',
      bodyHtml: '<p>IndexedDB에 등록된 소설만 앱에서 수정할 수 있습니다.</p>',
      onConfirm: null,
    });
    return;
  }

  const contentEl = document.getElementById('reader-content');
  if (!contentEl) return;

  const markdown = await resolveStoryContent(entry);
  isEditingContent = true;
  contentEl.classList.add('is-editing');
  updateReaderNavState(catalog);
  emit('reader:story-changed', { number: currentStoryNum });

  contentEl.innerHTML = '<textarea id="reader-edit-textarea" class="reader-edit-textarea" spellcheck="false" aria-label="소설 본문 편집"></textarea>';
  const textarea = document.getElementById('reader-edit-textarea');
  if (!textarea) return;
  textarea.value = markdown;

  const fontSlider = document.getElementById('reader-font-size');
  if (fontSlider) textarea.style.fontSize = `${fontSlider.value}px`;

  textarea.focus();
}

async function saveContentEdit() {
  if (!project.canManageCurrentProject()) return;

  const entry = catalog.find((s) => s.number === currentStoryNum);
  const textarea = document.getElementById('reader-edit-textarea');
  if (!entry || !textarea) return;

  const story = project.getStoryByNumber(entry.number);
  if (!story?.id) return;

  const content = textarea.value;
  await project.updateStory(story.id, content);

  entry.content = content;
  isEditingContent = false;
  document.getElementById('reader-content')?.classList.remove('is-editing');

  autosave.markDirty();
  emit('project:loaded', project.getCurrentProject());

  const contentEl = document.getElementById('reader-content');
  await showStory(currentStoryNum, contentEl);
}

function cancelContentEdit() {
  isEditingContent = false;
  document.getElementById('reader-content')?.classList.remove('is-editing');
  const contentEl = document.getElementById('reader-content');
  showStory(currentStoryNum, contentEl);
}

async function deleteCurrentStory() {
  if (!project.canManageCurrentProject()) {
    alert('이 프로젝트의 소설은 소유 관리자 또는 마스터만 삭제할 수 있습니다.');
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
  if (!project.canManageCurrentProject()) {
    alert('이 프로젝트의 소설은 소유 관리자 또는 마스터만 삭제할 수 있습니다.');
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

/** TTS 하이라이트용 — 문단·제목 블록에 순번 부여 */
export function tagReaderBlocksForTts(inner) {
  if (!inner) return;
  inner.querySelectorAll('p, h1').forEach((el, i) => {
    el.dataset.ttsIdx = String(i);
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
