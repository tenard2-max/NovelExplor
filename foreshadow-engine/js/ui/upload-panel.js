/** 우측 파일 업로드 패널 */

import { emit, on } from '../core/events.js';
import { getSelectedCharacterId, registerDroppedImages } from './character-panel.js';

export const MAX_UPLOAD_FILES = 100;

const importLog = [];
// 현재 선택된(상세 패널이 열린) 인물 — 이미지 드롭 시 이 인물에 등록한다.
let selectedCharacter = { id: null, name: '' };

export function initUploadPanel() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('import-file');

  dropZone?.addEventListener('click', () => fileInput?.click());

  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone?.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    await handleDroppedFiles(e.dataTransfer?.files);
  });

  // 인물 선택 상태에 따라 드롭존 안내를 갱신한다.
  on('character:selection', (sel) => {
    selectedCharacter = { id: sel?.id || null, name: sel?.name || '' };
    updateDropHint();
  });

  document.querySelectorAll('[data-import]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.import;
      if (!fileInput) return;
      const accepts = { txt: '.txt', md: '.md', json: '.json', zip: '.zip' };
      fileInput.accept = accepts[type] || '*';
      fileInput.dataset.importType = type;
      fileInput.click();
    });
  });
}

/**
 * 드롭된 파일 처리.
 * 인물이 선택돼 있으면 이미지 파일은 그 인물의 갤러리에 등록하고,
 * 나머지(설정/소설/스토리 등)는 기존 임포트 경로로 넘긴다.
 */
async function handleDroppedFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const charId = getSelectedCharacterId();
  if (charId) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    const rest = files.filter((f) => !f.type.startsWith('image/'));
    if (images.length) {
      const count = await registerDroppedImages(images);
      if (count > 0) {
        logImport(`이미지 ${count}장 → ${selectedCharacter.name || '선택 인물'}`, true);
      }
    }
    if (rest.length) emitSelectedFiles(rest);
    return;
  }

  emitSelectedFiles(files);
}

function updateDropHint() {
  const hint = document.getElementById('drop-char-hint');
  const dropZone = document.getElementById('drop-zone');
  if (!hint) return;
  if (selectedCharacter.id) {
    hint.textContent = `🖼 이미지를 놓으면 "${selectedCharacter.name}"에 등록됩니다`;
    hint.hidden = false;
    dropZone?.classList.add('drop-zone--character');
  } else {
    hint.textContent = '';
    hint.hidden = true;
    dropZone?.classList.remove('drop-zone--character');
  }
}

/** FileList → 최대 100개 upload:files 이벤트 발행 */
export function emitSelectedFiles(fileList) {
  if (!fileList?.length) return;

  const all = Array.from(fileList);
  const files = all.slice(0, MAX_UPLOAD_FILES);

  if (all.length > MAX_UPLOAD_FILES) {
    emit('upload:limit', { total: all.length, max: MAX_UPLOAD_FILES });
  }

  emit('upload:files', files);
}

export function logImport(filename, success = true) {
  importLog.unshift({ filename, success, time: new Date().toLocaleTimeString('ko-KR') });
  if (importLog.length > 20) importLog.pop();
  renderLog();
}

function renderLog() {
  const ul = document.getElementById('import-log');
  if (!ul) return;
  if (!importLog.length) {
    ul.innerHTML = '<li class="import-log-empty">아직 없음</li>';
    return;
  }
  ul.innerHTML = importLog.map((l) =>
    `<li>${l.success ? '✓' : '✗'} ${l.filename} <small>${l.time}</small></li>`
  ).join('');
}
