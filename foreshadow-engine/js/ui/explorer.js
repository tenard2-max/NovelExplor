/** 탐색기 트리 */

import { on, emit } from '../core/events.js';
import { getSettingMdFiles } from '../core/utils.js';
import * as project from '../core/project.js';

const FOLDERS = [
  { id: 'novelmd', label: 'NovelMD', icon: '📁' },
  { id: 'story', label: 'Story', icon: '📖' },
  { id: 'character', label: 'Character', icon: '👤' },
  { id: 'world', label: 'World', icon: '🌍' },
  { id: 'foreshadow', label: 'Foreshadow', icon: '🔗' },
  { id: 'timeline', label: 'Timeline', icon: '📅' },
  { id: 'export', label: 'Export', icon: '📤' },
];

let expanded = new Set(['novelmd', 'story', 'foreshadow', 'character']);
let activeId = null;

export function initExplorer() {
  const tree = document.getElementById('explorer-tree');
  on('project:loaded', () => render(tree));
  document.querySelector('[data-action="refresh-explorer"]')?.addEventListener('click', () => render(tree));
}

function render(treeEl) {
  const cache = project.getCache();
  const proj = project.getCurrentProject();
  if (!proj) {
    treeEl.innerHTML = '<p class="inspector-empty" style="padding:12px">프로젝트를 열어주세요.</p>';
    return;
  }

  const parts = [];

  for (const folder of FOLDERS) {
    const isOpen = expanded.has(folder.id);
    parts.push(`
      <div class="tree-folder" data-folder="${folder.id}" style="--depth:0">
        <span class="tree-toggle">${isOpen ? '▼' : '▶'}</span>
        <span>${folder.icon} ${folder.label}</span>
      </div>
    `);

    if (!isOpen) continue;

    if (folder.id === 'novelmd') {
      for (const f of getSettingMdFiles(cache)) {
        parts.push(fileNode(f.id, f.path, 1, 'file'));
      }
    }

    if (folder.id === 'story') {
      const stories = cache.stories || [];
      if (stories.length) {
        parts.push(`<div class="tree-folder" data-folder="story-original" style="--depth:1"><span class="tree-toggle">▼</span><span>📕 Original (ST)</span></div>`);
        for (const st of stories) {
          parts.push(fileNode(st.id, `${st.textFile} — ${st.title}`, 2, 'story'));
        }
      }
      const episodes = cache.episodes || [];
      if (episodes.length) {
        parts.push(`<div class="tree-folder" data-folder="story-episodes" style="--depth:1"><span class="tree-toggle">▼</span><span>📝 Episodes (EP)</span></div>`);
        for (const ep of episodes) {
          parts.push(fileNode(ep.id, `${ep.textFile} — ${ep.title}`, 2, 'episode'));
        }
      }
    }

    if (folder.id === 'character') {
      for (const ch of cache.characters) {
        parts.push(fileNode(ch.id, ch.name, 1, 'character'));
      }
    }

    if (folder.id === 'world') {
      for (const w of cache.worlds) {
        parts.push(fileNode(w.id, w.name, 1, 'world'));
      }
    }

    if (folder.id === 'foreshadow') {
      for (const fs of cache.foreshadows) {
        parts.push(fileNode(fs.id, `[${fs.grade}] ${fs.title}`, 1, 'foreshadow'));
      }
    }

    if (folder.id === 'timeline') {
      for (const t of cache.timeline) {
        parts.push(fileNode(t.id, `EP${t.episode} ${t.title}`, 1, 'timeline'));
      }
    }

    if (folder.id === 'export') {
      parts.push(fileNode('export-json', 'project.json', 1, 'export'));
    }
  }

  treeEl.innerHTML = parts.join('');
  bindTreeEvents(treeEl);
}

function fileNode(id, label, depth, type = 'file') {
  const active = activeId === id ? ' active' : '';
  return `<div class="tree-file${active}" data-id="${id}" data-type="${type}" style="--depth:${depth}">📄 ${label}</div>`;
}

function bindTreeEvents(treeEl) {
  treeEl.querySelectorAll('.tree-folder').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.folder;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      render(treeEl);
    });
  });

  treeEl.querySelectorAll('.tree-file').forEach((el) => {
    el.addEventListener('click', () => {
      activeId = el.dataset.id;
      render(treeEl);
      emit('explorer:select', { id: el.dataset.id, type: el.dataset.type });
    });
  });
}

export function setActiveId(id) {
  activeId = id;
}
