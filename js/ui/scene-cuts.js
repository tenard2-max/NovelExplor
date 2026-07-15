/** 장면컷 목록·상세·생성·삭제 UI */

import * as project from '../core/project.js';
import { on } from '../core/events.js';
import { showAlert, showDialog } from './dialog.js';

const MAX_IMAGE_WIDTH = 1920;
let selectedSceneCutId = '';
let initialized = false;

export function initSceneCuts() {
  if (initialized) return;
  initialized = true;

  document.querySelector('[data-action="scene-cut-add"]')
    ?.addEventListener('click', createSceneCut);
  document.querySelector('[data-action="scene-cut-delete"]')
    ?.addEventListener('click', deleteSelectedSceneCut);
  document.getElementById('scene-cut-list')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-scene-cut-id]');
    if (!item) return;
    selectedSceneCutId = item.dataset.sceneCutId || '';
    renderSceneCuts();
  });

  on('project:loaded', () => {
    selectedSceneCutId = '';
    renderSceneCuts();
  });
  on('workspace:render', (viewId) => {
    if (viewId === 'scene-cuts') renderSceneCuts();
  });
  on('scene-cut:created', (sceneCut) => {
    selectedSceneCutId = sceneCut?.id || selectedSceneCutId;
    renderSceneCuts();
  });
  on('scene-cut:updated', renderSceneCuts);
  on('scene-cut:deleted', () => {
    selectedSceneCutId = '';
    renderSceneCuts();
  });
}

function getSceneCuts() {
  return [...(project.getCache().sceneCuts || [])].sort((a, b) => {
    const created = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    if (created !== 0) return created;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
}

function renderSceneCuts() {
  const listEl = document.getElementById('scene-cut-list');
  const detailEl = document.getElementById('scene-cut-detail');
  const countEl = document.getElementById('scene-cut-count');
  const deleteBtn = document.querySelector('[data-action="scene-cut-delete"]');
  if (!listEl || !detailEl) return;

  const sceneCuts = getSceneCuts();
  if (countEl) countEl.textContent = String(sceneCuts.length);

  if (!sceneCuts.some((item) => item.id === selectedSceneCutId)) {
    selectedSceneCutId = sceneCuts[0]?.id || '';
  }

  listEl.replaceChildren();
  if (!sceneCuts.length) {
    const empty = document.createElement('p');
    empty.className = 'scene-cut-list-empty';
    empty.textContent = '등록된 장면컷이 없습니다.';
    listEl.appendChild(empty);
  } else {
    for (const sceneCut of sceneCuts) {
      listEl.appendChild(createListItem(sceneCut));
    }
  }

  const selected = sceneCuts.find((item) => item.id === selectedSceneCutId) || null;
  if (deleteBtn) {
    deleteBtn.disabled = !selected;
    deleteBtn.hidden = !project.canManageCurrentProject();
  }
  renderDetail(detailEl, selected);
}

function createListItem(sceneCut) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'scene-cut-list-item';
  button.dataset.sceneCutId = sceneCut.id;
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', String(sceneCut.id === selectedSceneCutId));
  button.classList.toggle('is-selected', sceneCut.id === selectedSceneCutId);

  const imageUrl = sceneCutImageUrl(sceneCut);
  if (imageUrl) {
    const image = document.createElement('img');
    image.className = 'scene-cut-thumbnail';
    image.src = imageUrl;
    image.alt = '';
    image.loading = 'lazy';
    button.appendChild(image);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'scene-cut-thumbnail scene-cut-thumbnail--empty';
    placeholder.textContent = '🎬';
    button.appendChild(placeholder);
  }

  const text = document.createElement('span');
  text.className = 'scene-cut-list-text';
  const name = document.createElement('strong');
  name.textContent = sceneCut.name || '이름 없음';
  const description = document.createElement('small');
  description.textContent = sceneCut.description || '설명 없음';
  text.append(name, description);
  button.appendChild(text);
  return button;
}

function renderDetail(container, sceneCut) {
  container.replaceChildren();
  if (!sceneCut) {
    const empty = document.createElement('div');
    empty.className = 'scene-cut-empty';
    empty.innerHTML = `
      <span class="scene-cut-empty-icon" aria-hidden="true">🎬</span>
      <strong>장면컷을 생성하세요</strong>
      <p>신규 생성 버튼으로 이름, 상세 설명, 이미지를 등록할 수 있습니다.</p>`;
    container.appendChild(empty);
    return;
  }

  const figure = document.createElement('figure');
  figure.className = 'scene-cut-figure';
  const imageUrl = sceneCutImageUrl(sceneCut);
  if (imageUrl) {
    const image = document.createElement('img');
    image.className = 'scene-cut-main-image';
    image.src = imageUrl;
    image.alt = `${sceneCut.name || '장면컷'} 이미지`;
    figure.appendChild(image);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'scene-cut-main-image scene-cut-main-image--empty';
    placeholder.textContent = '이미지를 불러올 수 없습니다.';
    figure.appendChild(placeholder);
  }

  const info = document.createElement('section');
  info.className = 'scene-cut-info';
  const name = document.createElement('h2');
  name.textContent = sceneCut.name || '이름 없음';
  const date = document.createElement('time');
  date.className = 'scene-cut-created-at';
  date.dateTime = sceneCut.createdAt || '';
  date.textContent = `생성일: ${formatDate(sceneCut.createdAt)}`;
  const description = document.createElement('p');
  description.className = 'scene-cut-description';
  description.textContent = sceneCut.description || '상세 설명이 없습니다.';
  info.append(name, date, description);

  container.append(figure, info);
}

async function createSceneCut() {
  if (!project.canManageCurrentProject()) {
    await showAlert('장면컷', '이 프로젝트의 장면컷을 생성할 권한이 없습니다.');
    return;
  }

  let formValues = null;
  const confirmed = await showDialog({
    title: '장면컷 신규 생성',
    bodyHtml: `
      <div class="scene-cut-create-form">
        <label class="char-form-field">
          <span class="char-form-label">이름</span>
          <input id="scene-cut-create-name" class="char-form-input" type="text" maxlength="80"
                 placeholder="예: 폐허가 된 서울" required>
        </label>
        <label class="char-form-field">
          <span class="char-form-label">상세 설명</span>
          <textarea id="scene-cut-create-description" class="char-form-input" rows="5" maxlength="2000"
                    placeholder="장면의 장소, 시간, 분위기 등을 입력하세요."></textarea>
        </label>
        <label class="char-form-field">
          <span class="char-form-label">이미지</span>
          <input id="scene-cut-create-image" class="char-form-input" type="file" accept="image/*" required>
        </label>
      </div>`,
    onConfirm: () => {
      formValues = {
        name: document.getElementById('scene-cut-create-name')?.value || '',
        description: document.getElementById('scene-cut-create-description')?.value || '',
        file: document.getElementById('scene-cut-create-image')?.files?.[0] || null,
      };
    },
  });
  if (!confirmed || !formValues) return;

  const name = formValues.name.trim();
  if (!name || !formValues.file) {
    await showAlert('장면컷 생성 실패', '이름과 이미지를 모두 입력해 주세요.');
    return;
  }
  if (!formValues.file.type.startsWith('image/')) {
    await showAlert('장면컷 생성 실패', '이미지 파일만 등록할 수 있습니다.');
    return;
  }
  if (project.findSceneCutByName(name)) {
    await showAlert('장면컷 생성 실패', '같은 이름의 장면컷이 이미 있습니다.');
    return;
  }

  try {
    const image = await resizeImageToDataUrl(formValues.file, MAX_IMAGE_WIDTH);
    const created = await project.addSceneCut({
      name,
      description: formValues.description,
      image,
    });
    if (!created) throw new Error('장면컷을 저장하지 못했습니다.');
    selectedSceneCutId = created.id;
    renderSceneCuts();
  } catch (error) {
    await showAlert('장면컷 생성 실패', escapeHtml(error.message || error));
  }
}

async function deleteSelectedSceneCut() {
  if (!project.canManageCurrentProject()) {
    await showAlert('장면컷', '이 프로젝트의 장면컷을 삭제할 권한이 없습니다.');
    return;
  }

  const selected = getSceneCuts().find((item) => item.id === selectedSceneCutId);
  if (!selected) return;

  const confirmed = await showDialog({
    title: '장면컷 삭제',
    bodyHtml: `<p><strong>${escapeHtml(selected.name)}</strong> 장면컷을 삭제할까요?</p>
      <p>프로젝트 저장 전까지 GitHub 원격 스냅샷은 변경되지 않습니다.</p>`,
  });
  if (!confirmed) return;

  await project.deleteSceneCut(selected.id);
  selectedSceneCutId = '';
  renderSceneCuts();
}

function sceneCutImageUrl(sceneCut) {
  const raw = String(sceneCut?.image || sceneCut?.imagePath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('blob:') || /^https?:\/\//i.test(raw)) {
    return raw;
  }
  try {
    return new URL(raw.replace(/^\.\//, ''), document.baseURI).href;
  } catch {
    return raw;
  }
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ko-KR');
}

function resizeImageToDataUrl(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const ratio = image.width > maxWidth ? maxWidth / image.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('이미지 변환을 지원하지 않는 브라우저입니다.'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      image.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
      image.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('이미지 파일을 읽을 수 없습니다.'));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
