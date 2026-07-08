/** 통합 검색 */

import { isSettingMdPath } from '../core/utils.js';

export function searchAll(query, cache) {
  if (!query?.trim()) return [];
  const q = query.trim().toLowerCase();
  const results = [];

  for (const st of cache.stories || []) {
    const content = st.content || '';
    if (content.toLowerCase().includes(q)) {
      const idx = content.toLowerCase().indexOf(q);
      const start = Math.max(0, idx - 40);
      const snippet = content.slice(start, start + 100).replace(/\n/g, ' ');
      results.push({ type: 'story', id: st.id, label: `${st.textFile} ${st.title}`, snippet });
    }
  }

  for (const ep of cache.episodes || []) {
    const content = ep.content || '';
    if (content.toLowerCase().includes(q)) {
      const idx = content.toLowerCase().indexOf(q);
      const start = Math.max(0, idx - 40);
      const snippet = content.slice(start, start + 100).replace(/\n/g, ' ');
      results.push({ type: 'episode', id: ep.id, label: `EP${String(ep.number).padStart(3, '0')} ${ep.title}`, snippet });
    }
  }

  for (const ch of cache.characters || []) {
    const hay = [ch.name, ch.description, ...(ch.alias || [])].join(' ').toLowerCase();
    if (hay.includes(q)) {
      results.push({ type: 'character', id: ch.id, label: ch.name, snippet: ch.description || '' });
    }
  }

  for (const fs of cache.foreshadows || []) {
    const hay = [fs.title, fs.description, ...(fs.tags || [])].join(' ').toLowerCase();
    if (hay.includes(q)) {
      results.push({ type: 'foreshadow', id: fs.id, label: `[${fs.grade}] ${fs.title}`, snippet: fs.description || '' });
    }
  }

  for (const w of cache.worlds || []) {
    const hay = [w.name, w.description, w.category].join(' ').toLowerCase();
    if (hay.includes(q)) {
      results.push({ type: 'world', id: w.id, label: w.name, snippet: w.description || '' });
    }
  }

  for (const t of cache.timeline || []) {
    const hay = [t.title, t.description, t.date].join(' ').toLowerCase();
    if (hay.includes(q)) {
      results.push({ type: 'timeline', id: t.id, label: `EP${t.episode} ${t.title}`, snippet: t.description || '' });
    }
  }

  for (const f of cache.files || []) {
    if (!isSettingMdPath(f.path)) continue;
    const content = f.content || '';
    if (content.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) {
      const idx = content.toLowerCase().indexOf(q);
      const snippet = idx >= 0
        ? content.slice(Math.max(0, idx - 40), idx + 100).replace(/\n/g, ' ')
        : f.path;
      results.push({ type: 'setting', id: f.id, label: f.path, snippet });
    }
  }

  for (const f of cache.files || []) {
    if (isSettingMdPath(f.path)) continue;
    if ((f.content || '').toLowerCase().includes(q)) {
      results.push({ type: 'file', id: f.id, label: f.path, snippet: f.path });
    }
  }

  return results.slice(0, 50);
}
