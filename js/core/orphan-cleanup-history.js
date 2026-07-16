/** 고아 자산 정리 이력 (브라우저 IndexedDB settings) */

import * as storage from './storage.js';

const HISTORY_ID = 'orphan-cleanup-history';
const MAX_ENTRIES = 40;

/**
 * @typedef {{
 *   id: string,
 *   at: string,
 *   userId: string,
 *   username: string,
 *   role: string,
 *   trigger: string,
 *   snapshotIds: string[],
 *   snapshotLabels: string[],
 *   analyzed: boolean,
 *   projectOnlyCount: number,
 *   deletedCount: number,
 *   deletedPaths: string[],
 *   commitSha: string,
 *   autoDelete: boolean,
 *   restricted: boolean,
 *   note: string,
 * }} OrphanCleanupHistoryEntry
 */

/**
 * @returns {Promise<OrphanCleanupHistoryEntry[]>}
 */
export async function listOrphanCleanupHistory() {
  try {
    const row = await storage.get('settings', HISTORY_ID);
    const entries = Array.isArray(row?.entries) ? row.entries : [];
    return entries.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  } catch {
    return [];
  }
}

/**
 * @param {Partial<OrphanCleanupHistoryEntry>} entry
 * @returns {Promise<OrphanCleanupHistoryEntry>}
 */
export async function appendOrphanCleanupHistory(entry) {
  const prev = await listOrphanCleanupHistory();
  const record = {
    id: entry.id || `ocl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at || new Date().toISOString(),
    userId: entry.userId || '',
    username: entry.username || '',
    role: entry.role || '',
    trigger: entry.trigger || 'project-delete',
    snapshotIds: Array.isArray(entry.snapshotIds) ? entry.snapshotIds : [],
    snapshotLabels: Array.isArray(entry.snapshotLabels) ? entry.snapshotLabels : [],
    analyzed: Boolean(entry.analyzed),
    projectOnlyCount: Number(entry.projectOnlyCount) || 0,
    deletedCount: Number(entry.deletedCount) || 0,
    deletedPaths: Array.isArray(entry.deletedPaths) ? entry.deletedPaths.slice(0, 80) : [],
    commitSha: entry.commitSha || '',
    autoDelete: Boolean(entry.autoDelete),
    restricted: Boolean(entry.restricted),
    note: entry.note || '',
  };
  const entries = [record, ...prev].slice(0, MAX_ENTRIES);
  await storage.put('settings', { id: HISTORY_ID, entries, updatedAt: record.at });
  return record;
}

/**
 * @param {string} iso
 */
export function formatCleanupHistoryTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
