/** 인물 툴바 — 추가 · 삭제 · 자동추가 */

import { on } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { showDialog, showAlert } from './dialog.js';
import { openCharacterPanel, getSelectedCharacterId, deleteCharacterWithConfirm } from './character-panel.js';
import { initCharacterAutoAdd } from './character-autoadd.js';

const CHARACTER_VIEWS = new Set(['character', 'graph-character']);

export function initCharacterActions() {
  initCharacterAutoAdd();

  document.querySelector('[data-action="character-add"]')
    ?.addEventListener('click', () => runAddCharacter().catch(console.error));
  document.querySelector('[data-action="character-delete"]')
    ?.addEventListener('click', () => runDeleteCharacter().catch(console.error));

  on('view:changed', (viewId) => toggleControls(viewId));
  toggleControls('master');
}

function toggleControls(viewId) {
  const el = document.getElementById('character-controls');
  if (el) el.hidden = !CHARACTER_VIEWS.has(viewId);
  const graphControls = document.getElementById('graph-relation-controls');
  if (graphControls) graphControls.hidden = viewId !== 'graph-character';
}

async function runAddCharacter() {
  let name = '';
  let description = '';

  const confirmed = await showDialog({
    title: '인물 추가',
    bodyHtml: `
      <label class="char-form-field">
        <span class="char-form-label">이름</span>
        <input type="text" id="char-add-name" class="char-form-input" placeholder="예: 지은" maxlength="40" autocomplete="off">
      </label>
      <label class="char-form-field">
        <span class="char-form-label">설명 <small>(선택)</small></span>
        <textarea id="char-add-desc" class="char-form-input" rows="3" placeholder="간단한 소개"></textarea>
      </label>`,
    onConfirm: () => {
      name = document.getElementById('char-add-name')?.value?.trim() || '';
      description = document.getElementById('char-add-desc')?.value?.trim() || '';
    },
  });
  if (!confirmed) return;

  if (!name) {
    await showAlert('인물 추가', '이름을 입력하세요.');
    return;
  }

  const dup = project.getCache().characters.some((c) => c.name === name);
  if (dup) {
    await showAlert('인물 추가', `「${name}」은(는) 이미 등록된 인물입니다.`);
    return;
  }

  const rec = await project.addCharacter({ name, description });
  if (!rec) return;

  autosave.markDirty();
  openCharacterPanel(rec);
  await showAlert('인물 추가', `「${name}」을(를) 추가했습니다.`);
}

async function runDeleteCharacter() {
  const selectedId = getSelectedCharacterId();
  if (selectedId) {
    await deleteCharacterWithConfirm(selectedId);
    return;
  }

  const chars = project.getCache().characters || [];
  if (!chars.length) {
    await showAlert('인물 삭제', '삭제할 인물이 없습니다.');
    return;
  }

  const rows = chars.map((c, i) => `
    <label class="autoadd-row">
      <input type="radio" name="char-del-pick" value="${esc(c.id)}"${i === 0 ? ' checked' : ''}>
      <span class="autoadd-name">${esc(c.name)}</span>
      <span class="autoadd-meta">${esc(c.race || c.occupation || '')}</span>
    </label>`).join('');

  let pickedId = '';
  const confirmed = await showDialog({
    title: '인물 삭제',
    bodyHtml: `<p class="autoadd-desc">삭제할 인물을 선택하세요.</p><div class="autoadd-list">${rows}</div>`,
    onConfirm: () => {
      pickedId = document.querySelector('input[name="char-del-pick"]:checked')?.value || '';
    },
  });

  if (!confirmed || !pickedId) return;
  await deleteCharacterWithConfirm(pickedId);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
