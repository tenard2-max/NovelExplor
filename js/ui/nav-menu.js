/** 좌측 네비게이션 + 뷰 전환 */

import { emit, on } from '../core/events.js';
import * as project from '../core/project.js';
import { hideGraph } from '../graph/canvas-graph.js';
import { getSectionMeta } from '../core/workspace-xml.js';
import { renderSectionCanvas, bindSectionCanvasActions } from './section-canvas.js';

const VIEW_META = {
  master: { title: '마스터 DB', subtitle: 'sections/00_master.xml' },
  'story-bible': { title: 'Story Bible', subtitle: 'sections/01_story_bible.xml' },
  world: { title: '세계관', subtitle: 'sections/02_world.xml' },
  reader: { title: '소설 읽기', subtitle: 'sections/10_reader.xml' },
  'story-nav': { title: '스토리 네비게이터', subtitle: '현재 프로젝트 IndexedDB' },
  foreshadow: { title: '떡밥 회수', subtitle: 'sections/04_foreshadows.xml' },
  character: { title: '인물', subtitle: 'sections/03_characters.xml' },
  'scene-cuts': { title: '장면컷', subtitle: '현재 프로젝트 IndexedDB' },
  timeline: { title: '타임라인', subtitle: '이벤트 · 년월일' },
  editor: { title: '에디터', subtitle: 'sections/12_editor.xml' },
  settings: { title: '설정', subtitle: '계정 · 비밀번호 · 권한' },
  'graph-foreshadow': { title: '복선 그래프', subtitle: 'Canvas' },
  'graph-character': { title: '인물 관계도', subtitle: 'Canvas' },
  'graph-timeline': { title: '멀티버스', subtitle: '스토리 등장 EP · 등장 횟수 순' },
};

/** XML 섹션 캔버스 뷰 — reader는 기존 view-reader(Q4=B) 사용 */
const XML_CANVAS_VIEWS = new Set([
  'master', 'story-bible', 'world', 'foreshadow', 'character', 'timeline',
  'story-nav', 'editor',
]);

let currentView = 'master';

export function initNav() {
  document.getElementById('nav-menu')?.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    if (item.dataset.action) return;
    if (item.dataset.view) switchView(item.dataset.view);
  });

  on('project:loaded', updateBadges);
  on('project:loaded', () => {
    // DB 로드 후 현재 뷰가 IDB 우선 섹션이면 다시 그림
    if (currentView === 'character' || currentView === 'timeline' || currentView === 'story-nav') {
      loadXmlCanvas(currentView);
    }
  });
  on('timeline:updated', () => {
    if (currentView === 'timeline') loadXmlCanvas('timeline');
  });
  on('story-nav:updated', () => {
    if (currentView === 'story-nav') loadXmlCanvas('story-nav');
  });
  on('character:updated', () => {
    updateBadges();
    if (currentView === 'character') loadXmlCanvas('character');
  });
  on('character:deleted', () => {
    updateBadges();
    if (currentView === 'character') loadXmlCanvas('character');
  });
  on('scene-cut:created', updateBadges);
  on('scene-cut:updated', updateBadges);
  on('scene-cut:deleted', updateBadges);
}

export function switchView(viewId) {
  currentView = viewId;
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === viewId);
  });

  const meta = VIEW_META[viewId] || { title: viewId, subtitle: '' };
  document.getElementById('canvas-title').textContent = meta.title;
  document.getElementById('canvas-subtitle').textContent = meta.subtitle;

  const isGraph = viewId.startsWith('graph-');
  const canvasPanel = document.querySelector('.canvas-panel');
  canvasPanel?.classList.toggle('canvas-mode-graph', isGraph);

  document.getElementById('graph-layer').hidden = !isGraph;
  document.getElementById('workspace-layer').hidden = isGraph;

  hideAllViews();
  if (isGraph) {
    emit('view:changed', viewId);
    return;
  }

  hideGraph();
  emit('view:changed', viewId);

  const xmlMeta = getSectionMeta(viewId);
  if (XML_CANVAS_VIEWS.has(viewId) && xmlMeta?.src) {
    showView('view-xml-section');
    const sub = document.getElementById('canvas-subtitle');
    if (sub) sub.textContent = xmlMeta.src;
    loadXmlCanvas(viewId);
    return;
  }

  if (viewId === 'reader') {
    showView('view-reader');
    const sub = document.getElementById('canvas-subtitle');
    if (sub) sub.textContent = xmlMeta?.src || 'sections/10_reader.xml';
    emit('workspace:render', viewId);
    return;
  }

  if (viewId === 'scene-cuts') {
    showView('view-scene-cuts');
    emit('workspace:render', viewId);
    return;
  }

  showView('view-list');
  emit('workspace:render', viewId);
}

async function loadXmlCanvas(viewId) {
  const root = document.getElementById('xml-section-root');
  if (!root) return;
  try {
    await renderSectionCanvas(viewId, root);
    bindSectionCanvasActions(root);
  } catch (err) {
    root.innerHTML = `<p class="xml-section-error">${err.message}</p>`;
  }
}

export function getCurrentView() {
  return currentView;
}

function hideAllViews() {
  document.querySelectorAll('.workspace-view').forEach((v) => { v.hidden = true; });
}

function showView(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function updateBadges() {
  const cache = project.getCache();
  const proj = project.getCurrentProject();
  if (!proj) return;

  document.getElementById('nav-project-name').textContent = proj.title;
  document.getElementById('badge-foreshadow').textContent = cache.foreshadows?.length || 0;
  document.getElementById('badge-character').textContent = cache.characters?.length || 0;
  document.getElementById('badge-scene-cuts').textContent = cache.sceneCuts?.length || 0;
  document.getElementById('info-episodes').textContent = cache.episodes?.length || 0;
  document.getElementById('info-stories').textContent = project.getRegisteredStories().length;
  document.getElementById('info-foreshadows').textContent = cache.foreshadows?.length || 0;
  document.getElementById('info-characters').textContent = cache.characters?.length || 0;
  document.getElementById('status-project').textContent = proj.title;
}
