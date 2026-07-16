/** 프로젝트 제목 변경 이력 (브라우저 IndexedDB settings) */

import * as storage from './storage.js';
import { formatCleanupHistoryTime } from './orphan-cleanup-history.js';

const HISTORY_ID = 'project-title-history';
const MAX_ENTRIES = 40;

/**
 * @typedef {{
 *   id: string,
 *   at: string,
 *   userId: string,
 *   username: string,
 *   role: string,
 *   previousTitle: string,
 *   nextTitle: string,
 *   targets: string[],
 *   localId: string,
 *   ghSnapshotId: string,
 *   folderName: string,
 *   fileHint: string,
 *   commitSha: string,
 *   note: string,
 * }} ProjectTitleHistoryEntry
 */

/**
 * @returns {Promise<ProjectTitleHistoryEntry[]>}
 */
export async function listProjectTitleHistory() {
  try {
    const row = await storage.get('settings', HISTORY_ID);
    const entries = Array.isArray(row?.entries) ? row.entries : [];
    return entries.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  } catch {
    return [];
  }
}

/**
 * @param {Partial<ProjectTitleHistoryEntry>} entry
 * @returns {Promise<ProjectTitleHistoryEntry>}
 */
export async function appendProjectTitleHistory(entry) {
  const prev = await listProjectTitleHistory();
  const record = {
    id: entry.id || `pth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at || new Date().toISOString(),
    userId: entry.userId || '',
    username: entry.username || '',
    role: entry.role || '',
    previousTitle: entry.previousTitle || '',
    nextTitle: entry.nextTitle || '',
    targets: Array.isArray(entry.targets) ? entry.targets.slice(0, 8) : [],
    localId: entry.localId || '',
    ghSnapshotId: entry.ghSnapshotId || '',
    folderName: entry.folderName || '',
    fileHint: entry.fileHint || '',
    commitSha: entry.commitSha || '',
    note: entry.note || '',
  };
  const entries = [record, ...prev].slice(0, MAX_ENTRIES);
  await storage.put('settings', { id: HISTORY_ID, entries, updatedAt: record.at });
  return record;
}

export { formatCleanupHistoryTime as formatTitleHistoryTime };
