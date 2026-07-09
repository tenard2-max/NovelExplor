/** 편집기 패널 */

import { on, emit } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { UndoStack } from '../core/undo.js';
import { wordCount } from '../core/utils.js';
import { openCharacterPanel } from './character-panel.js';

let currentFile = null;
let currentType = null;
const undoStack = new UndoStack();

export function initEditor() {
  const editor = document.getElementById('editor');
  const lineNumbers = document.getElementById('line-numbers');

  on('explorer:select', (sel) => openItem(sel.id, sel.type));
  on('project:loaded', () => {
    currentFile = null;
    editor.value = '';
    document.getElementById('editor-filename').textContent = '파일을 선택하세요';
  });

  editor.addEventListener('input', () => {
    updateLineNumbers(editor, lineNumbers);
    updateCursorStatus(editor);
    if (currentFile && currentType !== 'story') {
      undoStack.push({ fileId: currentFile.id, content: editor.dataset.lastContent || '' });
      editor.dataset.lastContent = editor.value;
      autosave.markDirty();
      queueContentSave(editor.value);
    }
  });

  editor.addEventListener('click', () => updateCursorStatus(editor));
  editor.addEventListener('keyup', () => updateCursorStatus(editor));
  editor.addEventListener('scroll', () => { lineNumbers.scrollTop = editor.scrollTop; });

  document.querySelector('[data-action="undo"]')?.addEventListener('click', () => {
    const prev = undoStack.undo(editor.value);
    if (prev && prev.fileId === currentFile?.id) {
      editor.value = prev.content;
      updateLineNumbers(editor, lineNumbers);
      queueContentSave(editor.value);
      autosave.markDirty();
    }
  });

  document.querySelector('[data-action="redo"]')?.addEventListener('click', () => {
    const next = undoStack.redo(editor.value);
    if (next && next.fileId === currentFile?.id) {
      editor.value = next.content;
      updateLineNumbers(editor, lineNumbers);
      queueContentSave(editor.value);
      autosave.markDirty();
    }
  });

  document.querySelector('[data-action="find"]')?.addEventListener('click', () => {
    const q = prompt('찾을 문자열:');
    if (!q) return;
    const idx = editor.value.indexOf(q);
    if (idx < 0) alert('찾을 수 없습니다.');
    else {
      editor.focus();
      editor.setSelectionRange(idx, idx + q.length);
    }
  });

  document.querySelector('[data-action="replace"]')?.addEventListener('click', () => {
    const q = prompt('찾을 문자열:');
    if (!q) return;
    const r = prompt('바꿀 문자열:');
    if (r === null) return;
    editor.value = editor.value.split(q).join(r);
    updateLineNumbers(editor, lineNumbers);
    queueContentSave(editor.value);
    autosave.markDirty();
  });
}

export async function flushPendingSave() {
  clearTimeout(saveDebounce);
  if (!currentFile || currentType === 'story') return;
  const editor = document.getElementById('editor');
  if (!editor) return;
  const content = editor.value;
  if (currentType === 'episode') {
    await project.updateEpisode(currentFile.id, content);
  } else if (currentFile.path) {
    await project.updateFile(currentFile.id, content);
  }
}

let saveDebounce = null;
function queueContentSave(content) {
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(async () => {
    if (!currentFile || currentType === 'story') return;
    if (currentType === 'episode') {
      await project.updateEpisode(currentFile.id, content);
    } else if (currentFile.path) {
      await project.updateFile(currentFile.id, content);
    }
  }, 300);
}

function openItem(id, type) {
  const cache = project.getCache();
  currentType = type;
  const editor = document.getElementById('editor');
  const filename = document.getElementById('editor-filename');

  let item = null;
  let content = '';

  if (type === 'episode') {
    item = cache.episodes.find((e) => e.id === id);
    content = item?.content || '';
    editor.readOnly = false;
  } else if (type === 'story') {
    item = cache.stories.find((s) => s.id === id);
    content = item?.content || '';
    editor.readOnly = true;
  } else if (type === 'character') {
    // 인물은 관계도와 공유하는 상세 패널로 연다 (속성 드로어 사용 안 함)
    const ch = cache.characters.find((x) => x.id === id);
    if (ch) openCharacterPanel(ch);
    return;
  } else if (type === 'foreshadow' || type === 'world' || type === 'timeline') {
    const map = { foreshadow: cache.foreshadows, world: cache.worlds, timeline: cache.timeline };
    item = map[type]?.find((x) => x.id === id);
    emit('inspector:show', { type, data: item });
    const drawer = document.getElementById('view-inspector-drawer');
    if (drawer) drawer.hidden = false;
    return;
  } else if (type === 'export') {
    filename.textContent = 'Export — JSON보내기는 파일 메뉴를 사용하세요';
    return;
  } else {
    item = cache.files.find((f) => f.id === id);
    content = item?.content || '';
  }

  if (!item) return;
  currentFile = item;
  editor.value = content;
  editor.dataset.lastContent = content;
  filename.textContent = type === 'story'
    ? `${item.textFile} · 소설 (ST, 읽기 전용)`
    : (item.path || item.textFile || item.title || id);

  const lineNumbers = document.getElementById('line-numbers');
  updateLineNumbers(editor, lineNumbers);
  updateCursorStatus(editor);
  emit('inspector:show', { type: type === 'story' ? 'story' : 'episode', data: item });
}

function updateLineNumbers(editor, lineNumbersEl) {
  const lines = editor.value.split('\n').length;
  lineNumbersEl.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  lineNumbersEl.scrollTop = editor.scrollTop;
}

function updateCursorStatus(editor) {
  const text = editor.value.slice(0, editor.selectionStart);
  const lines = text.split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  document.getElementById('status-cursor').textContent = `Ln ${line}, Col ${col}`;
  document.getElementById('status-words').textContent = `${wordCount(editor.value)} 단어`;
}

export function getEditorSelection() {
  const editor = document.getElementById('editor');
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  return editor.value.slice(start, end);
}

export function getCurrentEpisodeNumber() {
  if (currentType === 'episode' && currentFile) return currentFile.number;
  return null;
}
