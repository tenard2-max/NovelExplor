/** Inspector — 속성 편집 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { FORESHADOW_GRADES, FORESHADOW_STATUSES, validateForeshadow } from '../core/utils.js';

export function initInspector() {
  on('inspector:show', (payload) => render(payload));
  on('foreshadow:updated', () => {});
  on('character:updated', () => {});
}

function render({ type, data }) {
  const el = document.getElementById('inspector-content');
  if (!data) {
    el.innerHTML = '<p class="inspector-empty">항목을 선택하면 속성이 표시됩니다.</p>';
    return;
  }

  if (type === 'foreshadow') {
    el.innerHTML = foreshadowForm(data);
    bindForeshadowForm(el, data);
  } else if (type === 'world') {
    el.innerHTML = worldView(data);
  } else if (type === 'timeline') {
    el.innerHTML = timelineView(data);
  } else if (type === 'file') {
    el.innerHTML = fileView(data);
  } else if (type === 'episode' || type === 'story') {
    el.innerHTML = episodeView(data);
  }
}

function foreshadowForm(fs) {
  const gradeOpts = FORESHADOW_GRADES.map((g) =>
    `<option value="${g}" ${fs.grade === g ? 'selected' : ''}>${g}</option>`
  ).join('');
  const statusOpts = FORESHADOW_STATUSES.map((s) =>
    `<option value="${s}" ${fs.status === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  return `
    <form class="inspector-form" data-form="foreshadow">
      <p><span class="grade-badge grade-${fs.grade}">${fs.grade}</span>
         <span class="status-${fs.status}">${fs.status}</span></p>
      <label>제목<input name="title" value="${esc(fs.title)}" required></label>
      <label>설명<textarea name="description">${esc(fs.description || '')}</textarea></label>
      <label>등급<select name="grade">${gradeOpts}</select></label>
      <label>상태<select name="status">${statusOpts}</select></label>
      <label>생성 화<input type="number" name="createdEpisode" value="${fs.createdEpisode || 1}"></label>
      <label>예상 회수 화<input type="number" name="expectedEpisode" value="${fs.expectedEpisode || 0}"></label>
      <label>실제 회수 화<input type="number" name="resolvedEpisode" value="${fs.resolvedEpisode || 0}"></label>
      <label>태그 (쉼표 구분)<input name="tags" value="${esc((fs.tags || []).join(', '))}"></label>
      <button type="submit" class="btn-primary" style="width:100%">저장</button>
    </form>
  `;
}

function bindForeshadowForm(el, data) {
  el.querySelector('form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const updated = {
      ...data,
      title: fd.get('title'),
      description: fd.get('description'),
      grade: fd.get('grade'),
      status: fd.get('status'),
      createdEpisode: parseInt(fd.get('createdEpisode'), 10),
      expectedEpisode: parseInt(fd.get('expectedEpisode'), 10),
      resolvedEpisode: parseInt(fd.get('resolvedEpisode'), 10),
      tags: String(fd.get('tags')).split(',').map((t) => t.trim()).filter(Boolean),
    };
    const err = validateForeshadow(updated);
    if (err) { alert(err); return; }
    await project.updateForeshadow(updated);
    autosave.markDirty();
    render({ type: 'foreshadow', data: updated });
  });
}

function worldView(w) {
  return `
    <div class="inspector-form">
      <p><strong>${esc(w.name)}</strong> <small>(${esc(w.category)})</small></p>
      <p>${esc(w.description || '')}</p>
    </div>
  `;
}

function timelineView(t) {
  return `
    <div class="inspector-form">
      <p><strong>EP${t.episode}</strong> · ${esc(t.date || '')}</p>
      <p><strong>${esc(t.title)}</strong></p>
      <p>${esc(t.description || '')}</p>
    </div>
  `;
}

function episodeView(ep) {
  return `
    <div class="inspector-form">
      <p><strong>${esc(ep.textFile || `EP${ep.number}`)}</strong></p>
      <p>${esc(ep.title || '')}</p>
      <p><small>${(ep.content || '').length} 자 · ${wordCount(ep.content || '')} 단어</small></p>
    </div>
  `;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function fileView(f) {
  return `
    <div class="inspector-form">
      <p><strong>${esc(f.path)}</strong></p>
      <p><small>${f.folder || 'Story'}</small></p>
      <p>${(f.content || '').length} 자</p>
    </div>
  `;
}

function esc(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
