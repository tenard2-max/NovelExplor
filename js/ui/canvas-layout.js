/** Canvas 영역 높이 동기화 — 툴바~상태바 사이 전체 사용 */

import { on } from '../core/events.js';

export function syncCanvasLayout() {
  const panel = document.querySelector('.canvas-panel');
  const toolbar = panel?.querySelector('.canvas-toolbar');
  const status = panel?.querySelector('.canvas-status');
  const body = panel?.querySelector('.canvas-body');
  if (!panel || !body) return;

  const h = panel.clientHeight - (toolbar?.offsetHeight || 0) - (status?.offsetHeight || 0);
  body.style.height = `${Math.max(h, 200)}px`;

  const graph = document.getElementById('graph-layer');
  if (graph && !graph.hidden) graph.style.height = `${body.clientHeight}px`;
}

export function initCanvasLayout() {
  const sync = () => requestAnimationFrame(syncCanvasLayout);

  window.addEventListener('resize', sync);
  on('view:changed', sync);
  on('workspace:render', sync);
  on('project:loaded', sync);
  sync();
  setTimeout(syncCanvasLayout, 100);
}
