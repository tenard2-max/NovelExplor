/** 좌측 네비게이션 + 뷰 전환 */

import { emit, on } from '../core/events.js';
import * as project from '../core/project.js';
import { hideGraph } from '../graph/canvas-graph.js';

const VIEW_META = {
  master: { title: '마스터 DB', subtitle: '00_MASTER.md' },
  'story-bible': { title: 'Story Bible', subtitle: '01_STORY_BIBLE.md' },
  world: { title: '세계관', subtitle: '00_*.md · 설정' },
  reader: { title: '소설 읽기', subtitle: 'ST*.md · Novel' },
  'story-nav': { title: '스토리 네비게이터', subtitle: 'EP*.md · Episode Editor' },
  foreshadow: { title: '떡밥 회수', subtitle: 'Foreshadow DB' },
  character: { title: '인물', subtitle: 'Character DB' },
  timeline: { title: '타임라인', subtitle: 'Timeline' },
  editor: { title: '에디터', subtitle: 'Markdown / TXT' },
  'graph-foreshadow': { title: '복선 그래프', subtitle: 'Canvas' },
  'graph-character': { title: '인물 관계도', subtitle: 'Canvas' },
  'graph-timeline': { title: '타임라인 그래프', subtitle: 'Canvas' },
};

let currentView = 'master';

export function initNav() {
  document.getElementById('nav-menu')?.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    if (item.dataset.action) return;
    if (item.dataset.view) switchView(item.dataset.view);
  });

  on('project:loaded', updateBadges);
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

  if (viewId === 'reader') showView('view-reader');
  else if (viewId === 'story-nav' || viewId === 'editor') showView('view-story-nav');
  else showView('view-list');

  emit('workspace:render', viewId);
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
  document.getElementById('info-episodes').textContent = cache.episodes?.length || 0;
  document.getElementById('info-stories').textContent = project.getRegisteredStories().length;
  document.getElementById('info-foreshadows').textContent = cache.foreshadows?.length || 0;
  document.getElementById('info-characters').textContent = cache.characters?.length || 0;
  document.getElementById('status-project').textContent = proj.title;
}
