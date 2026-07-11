/** 프로젝트 동기화 폴더 (File System Access) — 마지막 저장 위치 기억 */

const HANDLE_DB = 'NovelExplorSyncFolder';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'project-sync-dir';

/** @type {FileSystemDirectoryHandle | null} */
let dirHandle = null;

const TS_JSON_RE = /^(\d{14})(?:_([^.]+))?\.json$/i;

export function getSyncDirHandle() {
  return dirHandle;
}

export function hasSyncDir() {
  return Boolean(dirHandle);
}

export async function initSyncFolder() {
  try {
    dirHandle = await loadHandleFromIdb();
    if (dirHandle) {
      const ok = await ensurePermission(dirHandle, false);
      if (!ok) dirHandle = null;
    }
  } catch (err) {
    console.warn('[sync-folder] 핸들 복원 실패:', err);
    dirHandle = null;
  }
  return dirHandle;
}

/** 사용자가 폴더를 선택·연결 */
export async function pickSyncDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error('이 브라우저는 폴더 연결을 지원하지 않습니다. Chrome/Edge를 사용하세요.');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  dirHandle = handle;
  await saveHandleToIdb(handle);
  return handle;
}

export async function clearSyncDirectory() {
  dirHandle = null;
  await deleteHandleFromIdb();
}

/**
 * 폴더 안 YYYYMMDDHHMMSS.json / YYYYMMDDHHMMSS_테마.json 목록 (최신순)
 * @returns {Promise<Array<{ name: string, stamp: string, theme: string, label: string, handle: FileSystemFileHandle }>>}
 */
export async function listTimestampBackups() {
  if (!dirHandle) return [];
  const ok = await ensurePermission(dirHandle, false);
  if (!ok) return [];

  const items = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    const m = name.match(TS_JSON_RE);
    if (!m) continue;
    const stamp = m[1];
    const theme = m[2] || '';
    items.push({
      name,
      stamp,
      theme,
      label: theme ? `${formatStampLabel(stamp)} · ${theme}` : formatStampLabel(stamp),
      handle,
    });
  }
  items.sort((a, b) => b.stamp.localeCompare(a.stamp) || b.name.localeCompare(a.name));
  return items;
}

export async function readBackupFile(fileHandle) {
  const file = await fileHandle.getFile();
  return file;
}

/** 동기화 폴더에 JSON 저장 (연결돼 있을 때) */
export async function writeBackupToSyncFolder(filename, content) {
  if (!dirHandle) return false;
  const ok = await ensurePermission(dirHandle, true);
  if (!ok) return false;
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return true;
}

export function getSyncFolderLabel() {
  return dirHandle?.name || '';
}

function formatStampLabel(stamp) {
  if (!/^\d{14}$/.test(stamp)) return stamp;
  const y = stamp.slice(0, 4);
  const mo = stamp.slice(4, 6);
  const d = stamp.slice(6, 8);
  const h = stamp.slice(8, 10);
  const mi = stamp.slice(10, 12);
  const s = stamp.slice(12, 14);
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

async function ensurePermission(handle, write) {
  const opts = { mode: write ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandleToIdb(handle) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandleFromIdb() {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly');
    const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteHandleFromIdb() {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
