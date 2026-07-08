/** 리더 패널 — ST*.md 소설 문서 전용 */

import { on, emit } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { simpleMarkdownToHtml, formatStoryReaderLabel } from '../core/utils.js';
import { showDialog } from './dialog.js';

const LIST_VISIBLE_ROWS = 10;

let currentStoryNum = null;

export function initReader() {
  const select = document.getElementById('reader-episode-select');
  const content = document.getElementById('reader-content');
  const fontSlider = document.getElementById('reader-font-size');

  initScrollableSelect(select);

  on('project:loaded', () => refreshReader());
  on('workspace:render', (viewId) => {
    if (viewId === 'reader') refreshReader();
  });

  select?.addEventListener('change', () => {
    showStory(parseInt(select.value, 10), content);
  });

  fontSlider?.addEventListener('input', () => {
    if (content) content.style.fontSize = `${fontSlider.value}px`;
  });

  document.querySelector('[data-action="prev-episode"]')?.addEventListener('click', () => {
    const stories = project.getRegisteredStories();
    const idx = stories.findIndex((s) => s.number === currentStoryNum);
    if (idx > 0) showStory(stories[idx - 1].number, content, select);
  });

  document.querySelector('[data-action="next-episode"]')?.addEventListener('click', () => {
    const stories = project.getRegisteredStories();
    const idx = stories.findIndex((s) => s.number === currentStoryNum);
    if (idx >= 0 && idx < stories.length - 1) showStory(stories[idx + 1].number, content, select);
  });

  document.querySelector('[data-action="delete-story"]')?.addEventListener('click', () => {
    deleteCurrentStory();
  });

  document.querySelector('[data-action="delete-all-stories"]')?.addEventListener('click', () => {
    deleteAllStories();
  });
}

/** 포커스 시 최대 10행 표시 + 스크롤로 100개 이상 선택 */
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

export function refreshReader() {
  const select = document.getElementById('reader-episode-select');
  const content = document.getElementById('reader-content');
  const stories = project.getRegisteredStories();

  populateSelect(select, stories);
  updateReaderNavState(stories);

  if (!stories.length) {
    currentStoryNum = null;
    if (content) {
      content.innerHTML = '<p class="inspector-empty">등록된 소설이 없습니다.<br>우측 파일 패널에서 <strong>ST*.md</strong> 또는 TXT를 업로드하세요.</p>';
    }
    return;
  }

  const keep = stories.some((s) => s.number === currentStoryNum);
  const num = keep ? currentStoryNum : stories[0].number;
  showStory(num, content, select);
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
    const label = formatStoryReaderLabel(s);
    return `<option value="${s.number}">${escapeHtml(label)}</option>`;
  }).join('');
}

function updateReaderNavState(stories) {
  const hasStories = stories.length > 0;
  document.querySelector('[data-action="prev-episode"]')?.toggleAttribute('disabled', !hasStories);
  document.querySelector('[data-action="next-episode"]')?.toggleAttribute('disabled', !hasStories);
  document.querySelector('[data-action="delete-story"]')?.toggleAttribute('disabled', !hasStories);
  document.querySelector('[data-action="delete-all-stories"]')?.toggleAttribute('disabled', !hasStories);
}

export function showStory(num, contentEl, selectEl) {
  const story = project.getStoryByNumber(num);
  if (!story || !contentEl) return;
  currentStoryNum = num;
  if (selectEl) selectEl.value = String(num);
  else document.getElementById('reader-episode-select').value = String(num);
  contentEl.innerHTML = `<div class="reader-inner">${simpleMarkdownToHtml(story.content || '')}</div>`;
}

export function getCurrentStoryNumber() {
  return currentStoryNum;
}

async function deleteCurrentStory() {
  const stories = project.getRegisteredStories();
  if (!stories.length || currentStoryNum == null) return;

  const story = project.getStoryByNumber(currentStoryNum);
  if (!story) return;

  await project.deleteStory(currentStoryNum);
  autosave.markDirty();
  emit('project:loaded', project.getCurrentProject());
}

async function deleteAllStories() {
  const stories = project.getRegisteredStories();
  if (!stories.length) return;

  const ok = await showDialog({
    title: '전체 소설 삭제',
    bodyHtml: `<p>등록된 소설 <strong>${stories.length}개</strong>를 모두 삭제합니다.<br>이 작업은 되돌릴 수 없습니다. 계속할까요?</p>`,
  });
  if (!ok) return;

  await project.deleteAllStories();
  autosave.markDirty();
  emit('project:loaded', project.getCurrentProject());
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
