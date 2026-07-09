/** 워크스페이스 리스트 뷰 렌더링 */

import { on, emit } from '../core/events.js';
import * as project from '../core/project.js';
import { switchView } from './nav-menu.js';
import { renderMasterDashboard, renderStoryBibleView, renderSettingDocsWorkspace, renderSettingMdView } from './md-render.js';
import { findSettingMdFile, getSettingMdFiles, parseSettingMdIndex } from '../core/utils.js';
import { showStory } from './reader.js';
import { deleteCharacterWithConfirm } from './character-panel.js';

export function initWorkspace() {
  on('workspace:render', renderView);
  on('project:loaded', () => {
    renderView(getActiveView());
    renderEpisodeList();
  });

  // 인물 이미지가 바뀌면(대표/갤러리 등록·삭제) 인물 목록 카드의 300×300 이미지를 갱신
  on('character:updated', () => {
    if (getActiveView() === 'character') renderView('character');
  });
  on('character:deleted', () => {
    if (getActiveView() === 'character') renderView('character');
  });

  document.querySelector('[data-action="close-inspector"]')?.addEventListener('click', () => {
    showInspectorDrawer(false);
  });
}

function getActiveView() {
  const active = document.querySelector('.nav-item.active[data-view]');
  return active?.dataset.view || 'master';
}

function renderView(viewId) {
  if (viewId === 'story-nav') {
    const pid = project.getCurrentProject()?.projectId;
    project.ensureEpisodesFromStories(project.getCache(), pid).then(() => renderEpisodeList());
    return;
  }
  if (viewId === 'reader' || viewId === 'editor' || viewId.startsWith('graph-')) return;

  const el = document.getElementById('list-content');
  if (!el) return;
  const cache = project.getCache();
  const proj = project.getCurrentProject();

  if (viewId === 'master') {
    const file = findMdFile('00_MASTER.md', cache);
    el.innerHTML = renderMasterDashboard(file, cache, proj);
    bindMdActions(el, file);
    bindEpChips(el);
  } else if (viewId === 'story-bible') {
    const file = findMdFile('01_STORY_BIBLE.md', cache);
    el.innerHTML = renderStoryBibleView(file);
    bindMdActions(el, file);
  } else if (viewId === 'world') {
    const docs = getSettingMdFiles(cache);
    const selected = findSettingMdFile(cache, '02_WORLD_SETTING.md')
      || docs.find((d) => parseSettingMdIndex(d.path) >= 2)
      || docs[0];
    el.innerHTML = renderSettingDocsWorkspace(docs, selected);
    bindSettingDocActions(el);
  } else if (viewId === 'foreshadow') {
    renderForeshadowWorkspace(el, cache);
  } else if (viewId === 'character') {
    renderCardList(el, cache.characters, (c) => ({
      id: c.id, type: 'character',
      title: c.name, badge: c.race,
      desc: c.description,
      image: c.avatarDataUrl || '',
      deletable: true,
    }));
  } else if (viewId === 'timeline') {
    renderCardList(el, cache.timeline, (t) => ({
      id: t.id, type: 'timeline',
      title: t.title, badge: `EP${t.episode}`,
      desc: `${t.date || ''} — ${t.description || ''}`,
    }));
  }
}

function findMdFile(path, cache) {
  return findSettingMdFile(cache, path);
}

function bindSettingDocActions(el) {
  const preview = el.querySelector('#setting-doc-preview');
  el.querySelectorAll('.setting-doc-card').forEach((card) => {
    card.addEventListener('click', () => {
      el.querySelectorAll('.setting-doc-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      const fileId = card.dataset.fileId;
      const file = project.getCache().files.find((f) => f.id === fileId);
      if (file && preview) {
        preview.innerHTML = renderSettingMdView(file);
        bindMdActions(preview, file);
      }
    });
  });
  el.querySelector('.setting-doc-card.active')?.click();
}

function bindMdActions(el, file) {
  el.querySelector('[data-open-file]')?.addEventListener('click', () => {
    if (!file) return;
    switchView('story-nav');
    emit('explorer:select', { id: file.id, type: 'file' });
  });
}

function bindEpChips(el) {
  el.querySelectorAll('.ep-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      switchView('reader');
      const num = parseInt(chip.dataset.epNum, 10);
      if (num) {
        const content = document.getElementById('reader-content');
        showStory(num, content);
      }
    });
  });
}

function renderForeshadowWorkspace(el, cache) {
  const open = cache.foreshadows.filter((f) => f.status === 'OPEN' || f.status === 'PROGRESS').length;
  el.innerHTML = `
    <div class="foreshadow-workspace">
      <div class="fs-workspace-header">
        <p>미회수 <strong>${open}</strong> / 전체 <strong>${cache.foreshadows.length}</strong></p>
        <button class="btn-sm" data-goto-graph="graph-foreshadow">Canvas 그래프 보기</button>
      </div>
      <div class="card-grid">${cache.foreshadows.map((f) => `
        <div class="data-card" data-id="${f.id}" data-type="foreshadow">
          <div class="card-header">
            <span class="card-badge grade-${f.grade}">${f.grade}</span>
            <strong>${escapeHtml(f.title)}</strong>
          </div>
          <p class="card-desc">${f.status} · EP${f.createdEpisode} → ${f.expectedEpisode}화</p>
        </div>
      `).join('')}</div>
    </div>`;

  el.querySelector('[data-goto-graph]')?.addEventListener('click', () => {
    switchView('graph-foreshadow');
  });

  el.querySelectorAll('.data-card').forEach((card) => {
    card.addEventListener('click', () => {
      emit('explorer:select', { id: card.dataset.id, type: card.dataset.type });
      showInspectorDrawer(true);
    });
  });
}

function renderCardList(el, items, mapFn) {
  if (!items?.length) {
    el.innerHTML = '<p class="inspector-empty">데이터가 없습니다.</p>';
    return;
  }
  const mapped = items.map(mapFn);
  // mapFn이 image 키를 준 목록(예: 인물)은 이름 아래 300×300 대표 이미지를 표시한다.
  const hasImages = mapped.some((m) => m.image !== undefined);

  el.innerHTML = `<div class="card-grid${hasImages ? ' card-grid--gallery' : ''}">${mapped.map((m) => {
    const gradeCls = m.gradeClass ? ` grade-${m.gradeClass}` : '';
    let imageBlock = '';
    if (m.image !== undefined) {
      imageBlock = m.image
        ? `<img class="card-rep-image" src="${m.image}" alt="${escapeHtml(m.title)} 대표 이미지">`
        : '<div class="card-rep-image card-rep-image--empty">이미지 없음<br><small>클릭해 등록</small></div>';
    }
    return `
      <div class="data-card" data-id="${m.id}" data-type="${m.type}">
        <div class="card-header">
          <span class="card-badge${gradeCls}">${m.badge}</span>
          <strong>${escapeHtml(m.title)}</strong>
          ${m.deletable ? `<button type="button" class="card-delete-btn" data-action="delete-character" title="인물 삭제" aria-label="인물 삭제">🗑</button>` : ''}
        </div>
        ${imageBlock}
        <p class="card-desc">${escapeHtml(m.desc || '')}</p>
      </div>`;
  }).join('')}</div>`;

  el.querySelectorAll('.data-card').forEach((card) => {
    card.querySelector('[data-action="delete-character"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteCharacterWithConfirm(card.dataset.id);
    });

    card.addEventListener('click', () => {
      const type = card.dataset.type;
      emit('explorer:select', { id: card.dataset.id, type });
      // 인물은 관계도와 동일한 상세 패널로 열고, 속성 드로어는 열지 않는다
      if (type !== 'character') showInspectorDrawer(true);
    });
  });
}

export function showInspectorDrawer(show) {
  const drawer = document.getElementById('view-inspector-drawer');
  if (drawer) drawer.hidden = !show;
}

export function renderEpisodeList() {
  const el = document.getElementById('episode-list');
  if (!el) return;
  const cache = project.getCache();
  el.innerHTML = cache.episodes.map((ep) => `
    <button class="episode-item" data-ep-id="${ep.id}" data-ep-num="${ep.number}">
      <span class="ep-num">EP${String(ep.number).padStart(3, '0')}</span>
      <span class="ep-title">${escapeHtml(ep.title)}</span>
    </button>
  `).join('');

  el.querySelectorAll('.episode-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.episode-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      emit('explorer:select', { id: btn.dataset.epId, type: 'episode' });
    });
  });

  const first = el.querySelector('.episode-item');
  if (first) first.click();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
