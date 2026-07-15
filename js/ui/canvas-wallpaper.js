/** 캔버스 배경 월페이퍼 — 등록 · 채도/알파/크기 조절 */

import * as storage from '../core/storage.js';
import * as project from '../core/project.js';
import { on, emit } from '../core/events.js';
import { getCurrentView } from './nav-menu.js';

const DEFAULTS = { saturation: 100, alpha: 45, size: 100 };
const MAX_IMAGE_WIDTH = 1600;

let state = { ...DEFAULTS, dataUrl: '' };
let ttsOverrideUrl = '';
let saveTimer = null;

export function initCanvasWallpaper() {
  const uploadBtn = document.querySelector('[data-action="wallpaper-upload"]');
  const fileInput = document.getElementById('wallpaper-file');
  const sat = document.getElementById('wp-saturation');
  const alpha = document.getElementById('wp-alpha');
  const size = document.getElementById('wp-size');

  uploadBtn?.addEventListener('click', () => {
    if (!project.canManageCurrentProject()) {
      alert('배경 이미지는 프로젝트 소유 관리자 또는 마스터만 등록할 수 있습니다.');
      return;
    }
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!project.canManageCurrentProject()) {
      alert('배경 이미지는 프로젝트 소유 관리자 또는 마스터만 등록할 수 있습니다.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 등록할 수 있습니다.');
      return;
    }
    try {
      ttsOverrideUrl = '';
      state.dataUrl = await resizeImageToDataUrl(file, MAX_IMAGE_WIDTH);
      applyWallpaper();
      await persistWallpaper();
    } catch (err) {
      alert(`월페이퍼 등록 실패: ${err.message}`);
    }
  });

  const onGauge = () => {
    state.saturation = Number(sat?.value ?? DEFAULTS.saturation);
    state.alpha = Number(alpha?.value ?? DEFAULTS.alpha);
    state.size = Number(size?.value ?? DEFAULTS.size);
    syncGaugeLabels();
    applyWallpaper();
    scheduleSave();
  };

  sat?.addEventListener('input', onGauge);
  alpha?.addEventListener('input', onGauge);
  size?.addEventListener('input', onGauge);

  on('project:loaded', () => {
    ttsOverrideUrl = '';
    loadWallpaperForProject();
  });
  on('view:changed', (viewId) => {
    toggleControls(viewId === 'reader');
    applyWallpaper(viewId);
  });
  on('workspace:render', (viewId) => applyWallpaper(viewId));

  toggleControls(false);
}

function toggleControls(show) {
  const el = document.getElementById('wallpaper-controls');
  if (el) el.hidden = !show;
}

function syncGaugeLabels() {
  setLabel('wp-saturation-val', `${state.saturation}%`);
  setLabel('wp-alpha-val', `${state.alpha}%`);
  setLabel('wp-size-val', `${state.size}%`);
}

function setLabel(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function syncGaugesFromState() {
  const sat = document.getElementById('wp-saturation');
  const alpha = document.getElementById('wp-alpha');
  const size = document.getElementById('wp-size');
  if (sat) sat.value = String(state.saturation);
  if (alpha) alpha.value = String(state.alpha);
  if (size) size.value = String(state.size);
  syncGaugeLabels();
}

function gaugeValue(raw, fallback, { min = 0, allowZero = true } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (!allowZero && n <= 0) return fallback;
  return Math.min(200, Math.max(min, n));
}

/** TTS 등 일시 배경 — 저장하지 않음, 마지막 캐릭터 사진 유지 */
export function setTtsWallpaper(dataUrl) {
  const url = String(dataUrl || '').trim();
  if (!url) return;

  ttsOverrideUrl = url;

  // 베이스 월페이퍼가 한 번도 없을 때 게이지 0이면 안 보이므로 기본값 보정
  if (!state.dataUrl) {
    state.saturation = gaugeValue(state.saturation, DEFAULTS.saturation);
    state.alpha = gaugeValue(state.alpha, DEFAULTS.alpha, { min: 1 });
    state.size = gaugeValue(state.size, DEFAULTS.size, { min: 1, allowZero: false });
  }

  // hidden → 표시 전환 시 첫 페인트 누락 방지: 즉시 + 디코드 후 재적용
  applyWallpaper();
  const img = new Image();
  img.onload = () => applyWallpaper();
  img.onerror = () => applyWallpaper();
  img.src = url;
  requestAnimationFrame(() => applyWallpaper());
}

/** TTS 일시 배경 해제 — 장면컷/[ ] 해제 후 기본 월페이퍼로 복귀 */
export function clearTtsWallpaper() {
  ttsOverrideUrl = '';
  applyWallpaper();
}

function getActiveWallpaperUrl() {
  return ttsOverrideUrl || state.dataUrl;
}

function isReaderViewVisible(viewId) {
  if (viewId === 'reader') return true;
  if ((viewId || getCurrentView()) === 'reader') return true;
  const readerView = document.getElementById('view-reader');
  return Boolean(readerView && !readerView.hidden);
}

function applyWallpaper(viewId) {
  const layer = document.getElementById('canvas-wallpaper-layer');
  const body = document.querySelector('.canvas-body');
  const reader = document.getElementById('reader-content');
  if (!layer || !body) return;

  const dataUrl = getActiveWallpaperUrl();
  const show = isReaderViewVisible(viewId) && !!dataUrl;

  if (!show) {
    layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true');
    layer.style.removeProperty('background-image');
    layer.style.removeProperty('background-size');
    layer.style.removeProperty('opacity');
    layer.style.removeProperty('filter');
    body.classList.remove('has-wallpaper');
    reader?.classList.remove('has-wallpaper-bg');
    return;
  }

  const saturation = gaugeValue(state.saturation, DEFAULTS.saturation);
  const alpha = gaugeValue(state.alpha, DEFAULTS.alpha, { min: 1 });
  const size = gaugeValue(state.size, DEFAULTS.size, { min: 1, allowZero: false });
  const imageUrl = `url(${JSON.stringify(dataUrl)})`;

  // 스타일을 먼저 넣고 hidden 해제 (최초 표시 시 배경 미적용 방지)
  layer.style.backgroundImage = imageUrl;
  layer.style.backgroundSize = `${size}%`;
  layer.style.opacity = String(alpha / 100);
  layer.style.filter = `saturate(${saturation}%)`;
  layer.hidden = false;
  layer.setAttribute('aria-hidden', 'false');
  void layer.offsetWidth;

  body.classList.add('has-wallpaper');
  reader?.classList.add('has-wallpaper-bg');
}

async function loadWallpaperForProject() {
  // ttsOverride는 project:loaded 핸들러에서만 초기화한다.
  // 여기서 지우면 비동기 로드 중 TTS 배경이 바로 사라질 수 있다.
  const proj = project.getCurrentProject();
  if (!proj) {
    state = { ...DEFAULTS, dataUrl: '' };
    syncGaugesFromState();
    applyWallpaper();
    return;
  }

  const saved = await storage.get('settings', `${proj.projectId}-canvas-wallpaper`);
  state = {
    dataUrl: saved?.dataUrl || '',
    saturation: gaugeValue(saved?.saturation, DEFAULTS.saturation),
    alpha: gaugeValue(saved?.alpha, DEFAULTS.alpha, { min: 1 }),
    size: gaugeValue(saved?.size, DEFAULTS.size, { min: 1, allowZero: false }),
  };
  syncGaugesFromState();
  applyWallpaper();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistWallpaper().catch(console.error);
  }, 400);
}

async function persistWallpaper() {
  const proj = project.getCurrentProject();
  if (!proj) return;

  await storage.put('settings', {
    id: `${proj.projectId}-canvas-wallpaper`,
    projectId: proj.projectId,
    dataUrl: state.dataUrl,
    saturation: state.saturation,
    alpha: state.alpha,
    size: state.size,
    updatedAt: new Date().toISOString(),
  });
  emit('wallpaper:updated', state);
}

function resizeImageToDataUrl(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.readAsDataURL(file);
  });
}
