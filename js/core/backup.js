/** 프로젝트 백업 — 파일 다운로드, 로컬 자동 백업, 복원 */

import * as storage from './storage.js';
import * as project from './project.js';
import { nowIso } from './utils.js';
import { emit, on } from './events.js';
import { showDialog, showAlert } from '../ui/dialog.js';

const BACKUP_VERSION = 1;
const LOCAL_KEY_PREFIX = 'fft-backup-';
const LOCAL_META_KEY = 'fft-backup-meta';
const AUTO_BACKUP_DELAY_MS = 3000;

let autoBackupTimer = null;

export function initBackup() {
  document.querySelector('[data-action="backup-download"]')
    ?.addEventListener('click', () => downloadBackupFile().catch(onBackupError));
  document.querySelector('[data-action="backup-restore"]')
    ?.addEventListener('click', () => document.getElementById('backup-file')?.click());

  document.getElementById('backup-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const ok = await restoreFromBackupFile(file);
      if (ok) refreshBackupStatus();
    } catch (err) {
      onBackupError(err);
    }
  });

  on('project:saved', () => scheduleAutoBackup());
  on('project:loaded', () => {
    refreshBackupStatus();
    const proj = project.getCurrentProject();
    const meta = readLocalBackupMeta();
    if (proj && (!meta || meta.projectId !== proj.projectId)) {
      scheduleAutoBackup();
    }
  });
}

/** DB가 비어 있을 때 로컬 백업 복원을 제안한다. */
export async function offerLocalRecovery() {
  const meta = readLocalBackupMeta();
  if (!meta?.projectId) return false;

  const payload = localStorage.getItem(`${LOCAL_KEY_PREFIX}${meta.projectId}`);
  if (!payload) return false;

  const when = formatBackupTime(meta.exportedAt);
  const liteNote = meta.backupType === 'lite'
    ? '<br><small>※ 이미지는 용량 제한으로 제외된 경량 백업입니다.</small>'
    : '';

  const confirmed = await showDialog({
    title: '로컬 백업 복원',
    bodyHtml: `<p>DB에 프로젝트가 없지만 브라우저에 로컬 백업이 있습니다.</p>
      <p><strong>${esc(meta.title || '프로젝트')}</strong><br>백업 시각: ${when}${liteNote}</p>
      <p>복원할까요?</p>`,
  });
  if (!confirmed) return false;

  await restoreFromBackup(payload);
  await showAlert('백업 복원', '로컬 백업에서 프로젝트를 복원했습니다.');
  emit('project:loaded', project.getCurrentProject());
  return true;
}

export async function downloadBackupFile() {
  const json = await buildBackupJson();
  if (!json) throw new Error('열린 프로젝트가 없습니다.');

  const proj = project.getCurrentProject();
  const safeTitle = (proj.title || 'project').replace(/[^\w가-힣-]+/g, '_').slice(0, 30);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  downloadText(json, `ForeshadowBackup_${safeTitle}_${stamp}.json`);

  // 파일 저장과 함께 로컬 백업도 갱신
  await saveLocalBackup();
  refreshBackupStatus();
  await showAlert('백업 저장', '백업 파일을 다운로드했습니다.\n브라우저 로컬 백업도 함께 갱신했습니다.');
}

export async function restoreFromBackupFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON 백업 파일이 아닙니다.');
  }
  if (!data.project && !data.stories && !data.episodes) {
    throw new Error('유효하지 않은 백업 파일입니다.');
  }

  const title = data.project?.title || file.name;
  const when = formatBackupTime(data.exportedAt);

  const confirmed = await showDialog({
    title: '백업 복원',
    bodyHtml: `<p><strong>${esc(title)}</strong> 백업을 복원합니다.</p>
      <p>백업 시각: ${when}<br>복원 시 새 프로젝트로 추가됩니다. 계속할까요?</p>`,
  });
  if (!confirmed) return false;

  await restoreFromBackup(text);
  await showAlert('백업 복원', '백업을 복원했습니다.');
  emit('project:loaded', project.getCurrentProject());
  return true;
}

export async function restoreFromBackup(jsonText) {
  await project.importProjectJson(jsonText);
  return project.getCurrentProject();
}

export function scheduleAutoBackup() {
  clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(() => {
    saveLocalBackup().then((result) => {
      if (result) refreshBackupStatus();
    }).catch(console.warn);
  }, AUTO_BACKUP_DELAY_MS);
}

export async function saveLocalBackup() {
  const proj = project.getCurrentProject();
  if (!proj) return null;

  const key = `${LOCAL_KEY_PREFIX}${proj.projectId}`;

  try {
    const json = await buildBackupJson({ lite: false });
    localStorage.setItem(key, json);
    writeLocalBackupMeta({
      projectId: proj.projectId,
      title: proj.title,
      exportedAt: JSON.parse(json).exportedAt,
      backupType: 'full',
      size: json.length,
    });
    emit('backup:saved', { backupType: 'full' });
    return { backupType: 'full' };
  } catch (err) {
    if (err?.name !== 'QuotaExceededError') throw err;
    const liteJson = await buildBackupJson({ lite: true });
    localStorage.setItem(key, liteJson);
    writeLocalBackupMeta({
      projectId: proj.projectId,
      title: proj.title,
      exportedAt: JSON.parse(liteJson).exportedAt,
      backupType: 'lite',
      size: liteJson.length,
    });
    emit('backup:saved', { backupType: 'lite' });
    return { backupType: 'lite' };
  }
}

export function refreshBackupStatus() {
  const el = document.getElementById('backup-status');
  if (!el) return;

  const proj = project.getCurrentProject();
  const meta = readLocalBackupMeta();
  if (!proj || !meta || meta.projectId !== proj.projectId) {
    el.textContent = '로컬 백업: 없음';
    return;
  }

  const when = formatBackupTime(meta.exportedAt);
  const type = meta.backupType === 'lite' ? ' (경량)' : '';
  el.textContent = `로컬 백업: ${when}${type}`;
}

async function buildBackupJson({ lite = false } = {}) {
  const proj = project.getCurrentProject();
  if (!proj) return null;

  const cache = project.getCache();
  const wallpaper = await storage.get('settings', `${proj.projectId}-canvas-wallpaper`);

  let characters = cache.characters;
  let settings = { canvasWallpaper: wallpaper || null };

  if (lite) {
    characters = characters.map((c) => ({
      ...c,
      avatarDataUrl: '',
      images: [],
    }));
    if (settings.canvasWallpaper) {
      settings = {
        canvasWallpaper: { ...settings.canvasWallpaper, dataUrl: '' },
      };
    }
  }

  const payload = {
    format: 'foreshadow-backup',
    version: BACKUP_VERSION,
    backupType: lite ? 'lite' : 'full',
    project: proj,
    stories: cache.stories,
    episodes: cache.episodes,
    characters,
    worlds: cache.worlds,
    foreshadows: cache.foreshadows,
    timeline: cache.timeline,
    files: cache.files,
    characterRelations: cache.characterRelations,
    settings,
    exportedAt: nowIso(),
  };

  return JSON.stringify(payload, null, 2);
}

function readLocalBackupMeta() {
  try {
    const raw = localStorage.getItem(LOCAL_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalBackupMeta(meta) {
  localStorage.setItem(LOCAL_META_KEY, JSON.stringify(meta));
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function formatBackupTime(iso) {
  if (!iso) return '알 수 없음';
  try {
    return new Date(iso).toLocaleString('ko-KR');
  } catch {
    return iso;
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function onBackupError(err) {
  console.error(err);
  showAlert('백업 오류', err.message || '백업 처리 중 오류가 발생했습니다.');
}
