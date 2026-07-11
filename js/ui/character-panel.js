/** 인물 상세 패널 — 대표 이미지(관계도 공유) + 이미지 갤러리(여러 장) + 풀사이즈 뷰어 */

import { on, emit } from '../core/events.js';
import * as project from '../core/project.js';
import * as autosave from '../core/autosave.js';
import { showDialog } from './dialog.js';
import { canManageCurrentProject } from '../core/project.js';

// 저장 최대 해상도 (풀사이즈 뷰어에서 선명하게 보이도록 충분히 크게)
const AVATAR_MAX_PX = 1200;

let currentId = null;
let isEditing = false;

function assertCanUploadImages() {
  if (canManageCurrentProject()) return true;
  alert('이 프로젝트의 인물 이미지는 소유 관리자 또는 마스터만 등록·변경할 수 있습니다.');
  return false;
}

export function initCharacterPanel() {
  const panel = document.getElementById('character-panel');
  if (!panel) return;

  const box = document.getElementById('char-avatar-box');
  const repInput = document.getElementById('character-avatar-file');
  const galleryInput = document.getElementById('character-images-file');
  const gallery = document.getElementById('char-gallery');

  document.querySelector('[data-action="close-char-panel"]')
    ?.addEventListener('click', closeCharacterPanel);
  document.querySelector('[data-action="char-delete"]')
    ?.addEventListener('click', () => onDeleteCharacter());
  document.querySelector('[data-action="char-edit"]')
    ?.addEventListener('click', () => startEdit());
  document.querySelector('[data-action="char-edit-save"]')
    ?.addEventListener('click', () => saveEdit().catch(console.error));
  document.querySelector('[data-action="char-edit-cancel"]')
    ?.addEventListener('click', () => cancelEdit());
  document.querySelector('[data-action="char-avatar-register"]')
    ?.addEventListener('click', () => {
      if (!assertCanUploadImages()) return;
      triggerPicker(repInput);
    });
  document.querySelector('[data-action="char-avatar-delete"]')
    ?.addEventListener('click', onDeleteRepresentative);
  document.querySelector('[data-action="char-images-add"]')
    ?.addEventListener('click', () => {
      if (!assertCanUploadImages()) return;
      triggerPicker(galleryInput);
    });

  // 대표 이미지 영역
  box?.addEventListener('click', onAvatarBoxClick);
  box?.addEventListener('dragover', (e) => {
    if (!canManageCurrentProject()) return;
    e.preventDefault();
    box.classList.add('is-dragover');
  });
  box?.addEventListener('dragleave', () => box.classList.remove('is-dragover'));
  box?.addEventListener('drop', onRepresentativeDrop);

  // 갤러리 영역 (여러 장 드롭)
  gallery?.addEventListener('dragover', (e) => {
    if (!canManageCurrentProject()) return;
    e.preventDefault();
    gallery.classList.add('is-dragover');
  });
  gallery?.addEventListener('dragleave', () => gallery.classList.remove('is-dragover'));
  gallery?.addEventListener('drop', onGalleryDrop);
  gallery?.addEventListener('click', onGalleryClick);

  // 권한 변경 시 패널 UI 갱신
  on('auth:changed', () => {
    const ch = getCurrentCharacter();
    if (ch) renderPanel(ch);
  });

  repInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await registerRepresentative(file);
  });

  galleryInput?.addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    await addGalleryImages(files);
  });

  const lightbox = document.getElementById('image-lightbox');
  lightbox?.addEventListener('click', closeImageLightbox);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const lb = document.getElementById('image-lightbox');
    if (lb && !lb.hidden) { closeImageLightbox(); return; }
    const p = document.getElementById('character-panel');
    if (p && !p.hidden) closeCharacterPanel();
  });

  // 다른 화면으로 이동하면 패널을 닫는다 (인물/관계도 어느 쪽에서 열어도 동일)
  on('view:changed', () => closeCharacterPanel());
  on('project:loaded', () => {
    closeCharacterPanel();
    currentId = null;
    isEditing = false;
  });
  on('project:cleared', () => {
    closeCharacterPanel();
    currentId = null;
    isEditing = false;
  });
}

export async function openCharacterPanel(character) {
  if (!character) return;
  currentId = character.id;
  isEditing = false;
  // 대표 이미지와 갤러리 정합성 정리 후 최신 데이터로 렌더
  await project.ensureCharacterImages(character.id);
  const ch = getCurrentCharacter() || character;
  renderPanel(ch);
  const panel = document.getElementById('character-panel');
  if (panel) panel.hidden = false;
  setCharacterPanelOpen(true);
  // 우측 파일 섹션이 "선택된 인물에 이미지 등록"을 안내/처리할 수 있도록 알림
  emit('character:selection', { id: ch.id, name: ch.name || '' });
}

export function closeCharacterPanel() {
  const panel = document.getElementById('character-panel');
  if (panel) panel.hidden = true;
  currentId = null;
  isEditing = false;
  setCharacterPanelOpen(false);
  emit('character:selection', { id: null, name: '' });
}

/** 정보 패널이 열리면 카드 그리드가 패널 폭만큼 줄어들도록 canvas-body에 표시 */
function setCharacterPanelOpen(open) {
  document.querySelector('.canvas-body')?.classList.toggle('has-character-panel', open);
}

/** 확인 다이얼로그 후 인물을 삭제한다. 패널·목록 카드에서 공통 사용 */
export async function deleteCharacterWithConfirm(characterOrId) {
  if (!canManageCurrentProject()) {
    alert('이 프로젝트의 인물은 소유 관리자 또는 마스터만 삭제할 수 있습니다.');
    return false;
  }
  const id = typeof characterOrId === 'string' ? characterOrId : characterOrId?.id;
  if (!id) return false;

  const ch = project.getCache().characters.find((c) => c.id === id);
  if (!ch) return false;

  const confirmed = await showDialog({
    title: '인물 삭제',
    bodyHtml: `<p><strong>${esc(ch.name || '이 인물')}</strong>을(를) 삭제합니다.<br>등록된 이미지와 관계도 연결도 함께 제거됩니다.<br>이 작업은 되돌릴 수 없습니다.</p>`,
  });
  if (!confirmed) return false;

  const ok = await project.deleteCharacter(id);
  if (!ok) return false;

  autosave.markDirty();
  if (currentId === id) closeCharacterPanel();
  return true;
}

/** 현재 선택된(패널이 열려 있는) 인물 id — 우측 파일 드롭존에서 사용 */
export function getSelectedCharacterId() {
  return currentId;
}

/**
 * 외부(우측 파일 드롭존)에서 넘어온 이미지 파일들을 선택된 인물의 갤러리에 등록한다.
 * @returns {Promise<number>} 실제 등록된 이미지 수
 */
export async function registerDroppedImages(files) {
  if (!currentId) return 0;
  if (!assertCanUploadImages()) return 0;
  const before = (getCurrentCharacter()?.images || []).length;
  await addGalleryImages(files);
  const after = (getCurrentCharacter()?.images || []).length;
  return Math.max(0, after - before);
}

export function openImageLightbox(url) {
  if (!url) return;
  const box = document.getElementById('image-lightbox');
  const img = document.getElementById('image-lightbox-img');
  if (!box || !img) return;
  img.src = url;
  box.hidden = false;
}

export function closeImageLightbox() {
  const box = document.getElementById('image-lightbox');
  if (box && !box.hidden) box.hidden = true;
}

function getCurrentCharacter() {
  if (!currentId) return null;
  return project.getCache().characters.find((c) => c.id === currentId) || null;
}

function refresh() {
  autosave.markDirty();
  const ch = getCurrentCharacter();
  if (ch) renderPanel(ch);
}

function renderPanel(ch) {
  document.getElementById('char-panel-name').textContent = ch.name || '캐릭터';

  const allowUpload = canManageCurrentProject();
  document.getElementById('character-panel')
    ?.classList.toggle('char-panel--no-upload', !allowUpload);
  document.getElementById('character-panel')
    ?.classList.toggle('char-panel--readonly', !allowUpload);

  const editBtn = document.querySelector('[data-action="char-edit"]');
  const deleteBtn = document.querySelector('[data-action="char-delete"]');
  if (editBtn) editBtn.hidden = !allowUpload || isEditing;
  if (deleteBtn) deleteBtn.hidden = !allowUpload;

  const img = document.getElementById('char-avatar-img');
  const empty = document.getElementById('char-avatar-empty');
  const actions = document.getElementById('char-avatar-actions');
  const avatar = ch.avatarDataUrl || ch.image || ch.avatar || '';
  const hasAvatar = !!avatar;

  if (hasAvatar) {
    img.src = avatar;
    img.hidden = false;
    if (empty) empty.hidden = true;
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.innerHTML = allowUpload
        ? '<span class="char-avatar-empty-icon">🖼</span><span>이미지를 끌어다 놓거나<br>클릭해서 등록</span>'
        : '<span class="char-avatar-empty-icon">🖼</span><span>등록된 이미지가 없습니다</span>';
    }
  }

  const reg = document.querySelector('[data-action="char-avatar-register"]');
  const del = document.querySelector('[data-action="char-avatar-delete"]');
  const addGalleryBtn = document.querySelector('[data-action="char-images-add"]');
  if (allowUpload) {
    if (actions) actions.hidden = false;
    if (reg) reg.hidden = hasAvatar;
    if (del) del.hidden = !hasAvatar;
    if (addGalleryBtn) addGalleryBtn.hidden = false;
  } else {
    if (actions) actions.hidden = true;
    if (reg) reg.hidden = true;
    if (del) del.hidden = true;
    if (addGalleryBtn) addGalleryBtn.hidden = true;
    isEditing = false;
  }

  const box = document.getElementById('char-avatar-box');
  if (box) {
    box.classList.toggle('char-avatar-box--readonly', !allowUpload);
    box.title = allowUpload
      ? (hasAvatar ? '클릭 → 원본 보기 / 드래그 앤 드롭으로 등록' : '클릭 또는 드롭으로 대표 이미지 등록')
      : (hasAvatar ? '클릭 → 원본 보기' : '등록된 이미지가 없습니다');
  }

  renderGallery(ch);
  renderInfoSection(ch);
}

function renderInfoSection(ch) {
  const viewEl = document.getElementById('char-panel-desc');
  const formEl = document.getElementById('char-panel-form');
  if (!viewEl || !formEl) return;

  if (isEditing) {
    viewEl.hidden = true;
    formEl.hidden = false;
    fillEditForm(ch);
    return;
  }

  viewEl.hidden = false;
  formEl.hidden = true;

  const rows = [
    ['종족', ch.race],
    ['성별', formatGender(ch.gender)],
    ['나이', ch.age ? `${ch.age}세` : ''],
    ['직업', ch.occupation],
    ['상태', formatStatus(ch.status)],
    ['등장', ch.firstEpisode ? `EP${ch.firstEpisode} ~ EP${ch.lastEpisode || ch.firstEpisode}` : ''],
  ].filter(([, v]) => v);

  viewEl.innerHTML =
    rows.map(([k, v]) => `<div class="char-desc-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')
    + (ch.description
      ? `<div class="char-desc-row char-desc-full"><dt>설명</dt><dd>${esc(ch.description)}</dd></div>`
      : '');
}

function fillEditForm(ch) {
  document.getElementById('char-edit-name').value = ch.name || '';
  document.getElementById('char-edit-race').value = ch.race || '';
  document.getElementById('char-edit-gender').value = ch.gender || '';
  document.getElementById('char-edit-age').value = ch.age ? String(ch.age) : '';
  document.getElementById('char-edit-occupation').value = ch.occupation || '';
  document.getElementById('char-edit-status').value = ch.status || 'Alive';
  document.getElementById('char-edit-first-ep').value = ch.firstEpisode ? String(ch.firstEpisode) : '';
  document.getElementById('char-edit-last-ep').value = ch.lastEpisode ? String(ch.lastEpisode) : '';
  document.getElementById('char-edit-desc').value = ch.description || '';
}

function startEdit() {
  if (!canManageCurrentProject()) {
    alert('이 프로젝트의 인물 정보는 소유 관리자 또는 마스터만 수정할 수 있습니다.');
    return;
  }
  if (!currentId) return;
  isEditing = true;
  const ch = getCurrentCharacter();
  if (ch) renderPanel(ch);
}

function cancelEdit() {
  isEditing = false;
  const ch = getCurrentCharacter();
  if (ch) renderPanel(ch);
}

async function saveEdit() {
  const ch = getCurrentCharacter();
  if (!ch) return;

  const name = document.getElementById('char-edit-name')?.value?.trim() || '';
  if (!name) {
    alert('이름을 입력하세요.');
    return;
  }

  const dup = project.getCache().characters.some((c) => c.id !== ch.id && c.name === name);
  if (dup) {
    alert(`「${name}」은(는) 이미 등록된 인물입니다.`);
    return;
  }

  const ageRaw = document.getElementById('char-edit-age')?.value;
  const firstEpRaw = document.getElementById('char-edit-first-ep')?.value;
  const lastEpRaw = document.getElementById('char-edit-last-ep')?.value;

  const updated = {
    ...ch,
    name,
    race: document.getElementById('char-edit-race')?.value?.trim() || '',
    gender: document.getElementById('char-edit-gender')?.value || '',
    age: ageRaw ? Number(ageRaw) : 0,
    occupation: document.getElementById('char-edit-occupation')?.value?.trim() || '',
    status: document.getElementById('char-edit-status')?.value || 'Alive',
    firstEpisode: firstEpRaw ? Number(firstEpRaw) : 0,
    lastEpisode: lastEpRaw ? Number(lastEpRaw) : 0,
    description: document.getElementById('char-edit-desc')?.value?.trim() || '',
    updatedAt: new Date().toISOString(),
  };

  if (updated.lastEpisode && updated.firstEpisode && updated.lastEpisode < updated.firstEpisode) {
    alert('마지막 EP는 첫 등장 EP보다 작을 수 없습니다.');
    return;
  }

  await project.updateCharacter(updated);
  isEditing = false;
  autosave.markDirty();
  renderPanel(updated);
  emit('character:selection', { id: updated.id, name: updated.name });
}

function formatGender(value) {
  if (value === 'M') return '남';
  if (value === 'F') return '여';
  if (value === 'O') return '기타';
  return value || '';
}

function formatStatus(value) {
  if (value === 'Alive') return '생존';
  if (value === 'Dead') return '사망';
  if (value === 'Unknown') return '불명';
  return value || '';
}

function renderGallery(ch) {
  const gallery = document.getElementById('char-gallery');
  const countEl = document.getElementById('char-gallery-count');
  if (!gallery) return;

  const images = Array.isArray(ch.images) ? ch.images : [];
  const allowUpload = canManageCurrentProject();
  if (countEl) countEl.textContent = images.length ? `${images.length}장` : '';

  if (!images.length) {
    gallery.innerHTML = allowUpload
      ? '<p class="char-gallery-empty">등록된 이미지가 없습니다. 파일을 끌어다 놓거나 “＋ 이미지 추가”로 여러 장 등록하세요.</p>'
      : '<p class="char-gallery-empty">등록된 이미지가 없습니다. (일반 사용자는 이미지 등록 불가)</p>';
    return;
  }

  gallery.innerHTML = images.map((url, i) => {
    const isRep = url === ch.avatarDataUrl;
    const tools = allowUpload
      ? `<div class="char-gallery-tools">
          <button type="button" class="char-gallery-btn" data-action="set-rep" title="대표로 지정">★</button>
          <button type="button" class="char-gallery-btn char-gallery-del" data-action="remove" title="삭제">✕</button>
        </div>`
      : '';
    return `
      <div class="char-gallery-item${isRep ? ' is-rep' : ''}" data-index="${i}">
        <img class="char-gallery-thumb" src="${url}" alt="이미지 ${i + 1}" data-action="view">
        ${tools}
        ${isRep ? '<span class="char-gallery-badge">대표</span>' : ''}
      </div>`;
  }).join('');
}

function triggerPicker(input) {
  if (!input || !currentId) return;
  input.value = '';
  input.click();
}

function onAvatarBoxClick() {
  const ch = getCurrentCharacter();
  if (!ch) return;
  if (ch.avatarDataUrl) {
    openImageLightbox(ch.avatarDataUrl);
  } else if (assertCanUploadImages()) {
    triggerPicker(document.getElementById('character-avatar-file'));
  }
}

async function onRepresentativeDrop(e) {
  e.preventDefault();
  document.getElementById('char-avatar-box')?.classList.remove('is-dragover');
  if (!assertCanUploadImages()) return;
  const file = e.dataTransfer?.files?.[0];
  await registerRepresentative(file);
}

async function onGalleryDrop(e) {
  e.preventDefault();
  document.getElementById('char-gallery')?.classList.remove('is-dragover');
  if (!assertCanUploadImages()) return;
  const files = [...(e.dataTransfer?.files || [])];
  await addGalleryImages(files);
}

async function onGalleryClick(e) {
  const btn = e.target.closest('[data-action]');
  const item = e.target.closest('.char-gallery-item');
  if (!btn || !item || !currentId) return;
  const index = Number(item.dataset.index);
  const action = btn.dataset.action;
  const ch = getCurrentCharacter();
  if (!ch || !Array.isArray(ch.images)) return;
  const url = ch.images[index];

  if (action === 'view') {
    openImageLightbox(url);
  } else if (action === 'set-rep') {
    if (!assertCanUploadImages()) return;
    await project.setCharacterRepresentative(currentId, url);
    refresh();
  } else if (action === 'remove') {
    if (!assertCanUploadImages()) return;
    await project.removeCharacterImage(currentId, index);
    refresh();
  }
}

async function registerRepresentative(file) {
  if (!file || !currentId) return;
  if (!assertCanUploadImages()) return;
  if (!file.type.startsWith('image/')) { alert('이미지 파일만 등록할 수 있습니다.'); return; }
  try {
    const dataUrl = await resizeImage(file, AVATAR_MAX_PX);
    await project.addCharacterImages(currentId, [dataUrl], { makeRepresentative: true });
    refresh();
  } catch (err) {
    alert(`이미지 등록 실패: ${err.message}`);
  }
}

async function addGalleryImages(files) {
  if (!currentId) return;
  if (!assertCanUploadImages()) return;
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  try {
    const dataUrls = await Promise.all(images.map((f) => resizeImage(f, AVATAR_MAX_PX)));
    await project.addCharacterImages(currentId, dataUrls);
    refresh();
  } catch (err) {
    alert(`이미지 등록 실패: ${err.message}`);
  }
}

async function onDeleteCharacter() {
  if (!currentId) return;
  await deleteCharacterWithConfirm(currentId);
}

async function onDeleteRepresentative() {
  const ch = getCurrentCharacter();
  if (!ch?.avatarDataUrl) return;
  if (!assertCanUploadImages()) return;
  if (!confirm('대표 이미지를 삭제할까요? (갤러리에서도 제거됩니다)')) return;
  const index = (ch.images || []).indexOf(ch.avatarDataUrl);
  if (index >= 0) {
    await project.removeCharacterImage(currentId, index);
  } else {
    await project.setCharacterRepresentative(currentId, '');
  }
  refresh();
}

function resizeImage(file, maxPx) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxPx / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvasEl = document.createElement('canvas');
        canvasEl.width = width;
        canvasEl.height = height;
        const cx = canvasEl.getContext('2d', { alpha: true });
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, 0, 0, width, height);
        resolve(canvasEl.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.readAsDataURL(file);
  });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
