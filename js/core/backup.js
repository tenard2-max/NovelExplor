/** 프로젝트 백업 — 파일 다운로드, 로컬 자동 백업, 복원 */

import * as storage from './storage.js';
import * as project from './project.js';
import { nowIso } from './utils.js';
import { emit, on } from './events.js';
import { showDialog, showAlert } from '../ui/dialog.js';
import {
  refreshNavVersions,
  setJsonVersionStamp,
  stampFromBackupFilename,
  stampFromExportedAt,
} from '../app-version.js';
import { writeBackupToSyncFolder, hasSyncDir, initSyncFolder } from './sync-folder.js';
import { syncProjectToGithub } from './github-sync.js';
import { hasGithubToken } from './github-config.js';

const BACKUP_VERSION = 1;
const LOCAL_KEY_PREFIX = 'fft-backup-';
const LOCAL_META_KEY = 'fft-backup-meta';
const AUTO_BACKUP_DELAY_MS = 3000;

let autoBackupTimer = null;

export function initBackup() {
  // 백업 UI는 프로젝트 저장/열기에 통합됨. 상태 표시·자동 로컬 스냅샷만 유지.
  on('project:saved', () => scheduleAutoBackup());
  on('project:loaded', () => {
    refreshBackupStatus();
    refreshNavVersions();
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

  await restoreFromBackup(payload, { replaceAll: true, exportedAt: meta.exportedAt });
  refreshNavVersions();
  await showAlert('백업 복원', '로컬 백업에서 프로젝트를 복원했습니다.');
  emit('project:loaded', project.getCurrentProject());
  return true;
}

export async function downloadBackupFile() {
  return exportTimestampedBackup({ notify: true });
}

/** YYYYMMDDHHMMSS.json 또는 YYYYMMDDHHMMSS_테마.json */
export function timestampBackupFilename(date = new Date(), theme = '') {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
  const tag = sanitizeThemeTag(theme);
  return tag ? `${stamp}_${tag}.json` : `${stamp}.json`;
}

/** 파일명 테일용 테마 태그 (경로 위험 문자 제거) */
export function sanitizeThemeTag(theme) {
  return String(theme || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[\\/:*?"<>|.#]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * 프로젝트 동기화 스냅샷: 저장 폴더 기록(가능 시) + JSON 다운로드 + 로컬 백업
 * @param {{ notify?: boolean, asDefault?: boolean, defaultTitle?: string, skipGithub?: boolean, theme?: string }} [options]
 */
export async function exportTimestampedBackup({
  notify = false,
  asDefault = false,
  defaultTitle = '',
  skipGithub = false,
  theme = '',
} = {}) {
  const json = await buildBackupJson();
  if (!json) throw new Error('열린 프로젝트가 없습니다.');

  const filename = timestampBackupFilename(new Date(), theme);
  await initSyncFolder();

  let savedToFolder = false;
  if (hasSyncDir()) {
    try {
      savedToFolder = await writeBackupToSyncFolder(filename, json);
    } catch (err) {
      console.warn('[backup] 동기화 폴더 저장 실패:', err);
    }
  }

  // 폴더에 못 썼으면 다운로드로 확보
  if (!savedToFolder) {
    downloadText(json, filename);
  }

  await saveLocalBackup();
  setJsonVersionFromSource(filename);
  refreshBackupStatus(filename);
  refreshNavVersions();

  let githubNote = '';
  if (!skipGithub && hasGithubToken()) {
    const stamp = filename.replace(/\.json$/i, '');
    try {
      const gh = await syncProjectToGithub({
        snapshotId: stamp,
        reason: asDefault ? 'default' : 'save',
        asDefault,
        defaultTitle,
      });
      if (gh) {
        githubNote = `<br>GitHub: <code>${gh.snapshotId}.json</code> (+${Math.max(0, gh.fileCount - 2)}개 자산)`;
        if (asDefault) githubNote += '<br>기본 프로젝트로 지정했습니다.';
      } else if (asDefault) {
        throw new Error('GitHub 동기화가 진행 중이거나 시작되지 않았습니다. 잠시 후 다시 시도하세요.');
      }
    } catch (err) {
      console.warn('[backup] GitHub 동기화 실패:', err);
      if (asDefault) throw err;
      githubNote = `<br><span style="color:var(--danger,#f87171)">GitHub 실패: ${esc(err.message)}</span>`;
    }
  }

  if (notify) {
    const where = savedToFolder
      ? '연결한 저장 폴더에 기록했습니다.'
      : 'JSON 파일을 다운로드했습니다. (폴더 연결 시 폴더에 저장됩니다)';
    await showAlert(
      '프로젝트 동기화',
      `DB를 저장했습니다.<br><code>${esc(filename)}</code><br>${where}${githubNote}`
    );
  }
  return filename;
}

/** JSON 백업 파일로 프로젝트 복원 (프로젝트 열기에서 사용) */
export async function openBackupJsonFile(file, { skipConfirm = false } = {}) {
  if (!file) return false;
  return restoreFromBackupFile(file, { skipConfirm });
}

export async function restoreFromBackupFile(file, { skipConfirm = false } = {}) {
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

  if (!skipConfirm) {
    const title = data.project?.title || file.name;
    const when = formatBackupTime(data.exportedAt);
    const confirmed = await showDialog({
      title: '프로젝트 열기 (JSON)',
      bodyHtml: `<p><strong>${esc(title)}</strong> 동기화 파일을 엽니다.</p>
        <p>백업 시각: ${when}<br>적용 시 브라우저 DB의 기존 프로젝트는 <strong>모두 이 파일로 교체</strong>됩니다. 계속할까요?</p>`,
    });
    if (!confirmed) return false;
  }

  await restoreFromBackup(text, { sourceFilename: file.name, exportedAt: data.exportedAt });
  const stamp = stampFromBackupFilename(file.name) || stampFromExportedAt(data.exportedAt);
  setJsonVersionFromSource(file.name, data.exportedAt);
  refreshBackupStatus(file.name);
  refreshNavVersions();

  if (hasGithubToken() && stamp) {
    try {
      await syncProjectToGithub({ snapshotId: stamp, reason: 'apply-json' });
    } catch (err) {
      console.warn('[backup] GitHub 적용 후 동기화 실패:', err);
    }
  }

  emit('project:loaded', project.getCurrentProject());
  return true;
}

export async function restoreFromBackup(jsonText, {
  replaceAll = true,
  sourceFilename = '',
  exportedAt = '',
} = {}) {
  if (replaceAll) {
    await project.clearAllProjects();
    clearLocalBackupCache();
  }
  await project.importProjectJson(jsonText);
  if (sourceFilename || exportedAt) {
    setJsonVersionFromSource(sourceFilename, exportedAt);
  }
  return project.getCurrentProject();
}

function setJsonVersionFromSource(filename = '', exportedAt = '') {
  const stamp = stampFromBackupFilename(filename) || stampFromExportedAt(exportedAt);
  if (stamp) setJsonVersionStamp(stamp);
}

function clearLocalBackupCache() {
  try {
    const metaRaw = localStorage.getItem(LOCAL_META_KEY);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      if (meta?.projectId) {
        localStorage.removeItem(`${LOCAL_KEY_PREFIX}${meta.projectId}`);
      }
    }
    localStorage.removeItem(LOCAL_META_KEY);
  } catch {
    /* ignore */
  }
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

export function refreshBackupStatus(lastFile = '') {
  const el = document.getElementById('backup-status');
  if (!el) return;

  const proj = project.getCurrentProject();
  const meta = readLocalBackupMeta();
  if (!proj || !meta || meta.projectId !== proj.projectId) {
    el.textContent = lastFile ? `최근 파일: ${lastFile}` : '최근 동기화: —';
    return;
  }

  const when = formatBackupTime(meta.exportedAt);
  const type = meta.backupType === 'lite' ? ' (경량)' : '';
  const fileNote = lastFile ? ` · ${lastFile}` : '';
  el.textContent = `최근 동기화: ${when}${type}${fileNote}`;
}

async function buildBackupJson({ lite = false } = {}) {
  const payload = await buildBackupPayload({ lite });
  return payload ? JSON.stringify(payload, null, 2) : null;
}

export async function buildBackupPayload({ lite = false } = {}) {
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

  return {
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
