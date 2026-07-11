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
  if (!list) return;
  const cache = project.getCache();
  if (!cache.timeline?.length) {
    list.innerHTML = '<p class="inspector-empty">타임라인 이벤트가 없습니다.</p>';
    return;
  }

  let events = dedupeTimelineByEpisode(cache.timeline)
    .map((t) => {
      const { date, title } = timelineDisplayParts(t);
      return { date, title };
    })
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));

  const sort = document.getElementById('timeline-sort')?.value || 'date';
  if (sort === 'episode') {
    /* 패널에서도 날짜 기준이 기본 — episode 옵션이 있으면 날짜 유지 */
  }
  events = [...events].sort((a, b) => a.date.localeCompare(b.date));

  if (!events.length) {
    list.innerHTML = '<p class="inspector-empty">년월일이 있는 이벤트가 없습니다.</p>';
    return;
  }

  const parts = [];
  events.forEach((e, i) => {
    parts.push(`
      <article class="tl-card tl-card--compact">
        <span class="tl-date">${e.date}</span>
        <span class="tl-title">${e.title}</span>
      </article>`);
    if (i < events.length - 1) {
      parts.push('<div class="tl-connector tl-connector--compact" aria-hidden="true"></div>');
    }
  });
  list.innerHTML = `<div class="tl-chain tl-chain--panel">${parts.join('')}</div>`;
}
