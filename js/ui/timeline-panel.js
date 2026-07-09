/** 타임라인 패널 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';

export function initTimeline() {
  on('project:loaded', render);
  on('foreshadow:updated', render);

  document.getElementById('timeline-sort')?.addEventListener('change', render);
  document.querySelector('[data-action="toggle-timeline"]')?.addEventListener('click', () => {
    const panel = document.getElementById('timeline-panel');
    panel.hidden = !panel.hidden;
  });
}

function render() {
  const list = document.getElementById('timeline-list');
  const cache = project.getCache();
  if (!cache.timeline?.length) {
    list.innerHTML = '<p class="inspector-empty">타임라인 이벤트가 없습니다.</p>';
    return;
  }

  const sort = document.getElementById('timeline-sort')?.value || 'episode';
  const items = [...cache.timeline];
  if (sort === 'date') items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  else items.sort((a, b) => a.episode - b.episode);

  list.innerHTML = items.map((t) => `
    <div class="timeline-item">
      <span>EP${String(t.episode).padStart(3, '0')}</span>
      <span><strong>${t.title}</strong><br><small>${t.description || ''}</small></span>
      <span><small>${t.date || ''}</small></span>
    </div>
  `).join('');
}
