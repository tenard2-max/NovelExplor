/** 타임라인 패널 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';
import { dedupeTimelineByEpisode, timelineDisplayParts } from '../core/story-sync-engine.js';

export function initTimeline() {
  on('project:loaded', render);
  on('foreshadow:updated', render);
  on('timeline:updated', render);

  document.getElementById('timeline-sort')?.addEventListener('change', render);
  document.querySelector('[data-action="toggle-timeline"]')?.addEventListener('click', () => {
    const panel = document.getElementById('timeline-panel');
    if (panel) panel.hidden = !panel.hidden;
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
  let items = dedupeTimelineByEpisode(cache.timeline);
  if (sort === 'date') items = [...items].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  list.innerHTML = items.map((t) => {
    const { date, title } = timelineDisplayParts(t);
    return `
    <div class="timeline-item">
      <span>EP${String(t.episode).padStart(3, '0')}</span>
      <span><strong>${date}</strong> ${title}</span>
    </div>`;
  }).join('');
}
