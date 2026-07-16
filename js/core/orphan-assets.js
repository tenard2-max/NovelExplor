/** GitHub 고아 자산 분석·수동 정리 */

import { getCurrentUser, isMaster, ROLES } from './auth.js';
import {
  getGithubConfig,
  overlaysDir,
  snapshotsDir,
  rawGithubUrl,
  hasGithubToken,
} from './github-config.js';
import {
  listRepoDir,
  invalidateRepoDirCache,
  deleteRepoPaths,
  repoPathExists,
} from './github-api.js';
import {
  listGithubProjectSnapshots,
  listGithubProjectsDetailed,
  canDeleteGithubProjectSnapshot,
  fetchGithubDefaultMeta,
} from './default-project.js';
import { runWithGithubSyncLock } from './github-sync.js';
import { trackedRawFetch } from './github-metrics.js';

const KIND_LABELS = {
  character: '인물 이미지',
  sceneCut: '장면컷',
  story: '스토리 본문',
  file: '기타 파일',
  wallpaper: '월페이퍼',
  other: '기타',
};

/** UI 그룹 필터 — 본문에는 stories + files 포함 */
export const ORPHAN_FILTERS = [
  { id: 'all', label: '전체', kinds: null },
  { id: 'story', label: '본문', kinds: ['story', 'file'] },
  { id: 'character', label: '인물 이미지', kinds: ['character'] },
  { id: 'sceneCut', label: '장면컷', kinds: ['sceneCut'] },
  { id: 'wallpaper', label: '월페이퍼', kinds: ['wallpaper'] },
];

/** 시스템·포인터 파일은 고아 후보/삭제 대상에서 제외 */
const EXCLUDED_BASENAMES = new Set([
  'upload-latest.json',
  'latest.json',
  'default.json',
  'readme.md',
  'readme.txt',
]);

/**
 * @typedef {{
 *   path: string,
 *   name: string,
 *   kind: string,
 *   kindLabel: string,
 *   size: number,
 * }} OrphanAssetEntry
 */

/**
 * @typedef {{
 *   snapshotCount: number,
 *   referencedCount: number,
 *   inventoryCount: number,
 *   orphanCount: number,
 *   orphanBytes: number,
 *   byKind: Record<string, { count: number, bytes: number, label: string }>,
 *   orphans: OrphanAssetEntry[],
 *   referencedPaths: string[],
 *   inventoryPaths: string[],
 *   errors: string[],
 * }} OrphanAnalysisResult
 */

/**
 * @typedef {{
 *   targetSnapshotIds: string[],
 *   targetSnapshotCount: number,
 *   otherSnapshotCount: number,
 *   targetRefCount: number,
 *   otherRefCount: number,
 *   projectOnlyCount: number,
 *   projectOnlyBytes: number,
 *   byKind: Record<string, { count: number, bytes: number, label: string }>,
 *   projectOnly: OrphanAssetEntry[],
 *   errors: string[],
 * }} ProjectScopedOrphanResult
 */

function normalizeRepoPath(path) {
  return String(path || '')
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\\/g, '/');
}

function addPath(set, path) {
  const normalized = normalizeRepoPath(path);
  if (!normalized) return;
  if (!/^(?:data\/workspace\/|data\/assets\/)/i.test(normalized)) return;
  set.add(normalized);
}

function collectPathsFromSnapshot(data, into) {
  for (const ch of data?.characters || []) {
    addPath(into, ch.avatarPath);
    if (Array.isArray(ch.imagePaths)) {
      for (const p of ch.imagePaths) addPath(into, p);
    }
  }

  for (const scene of data?.sceneCuts || []) {
    addPath(into, scene.imagePath);
  }

  for (const file of data?.files || []) {
    addPath(into, file.contentPath);
  }

  const wallpaper = data?.settings?.canvasWallpaper;
  if (wallpaper) addPath(into, wallpaper.dataPath);
}

function shouldSkipInventoryFile(entry) {
  const name = String(entry?.name || '').toLowerCase();
  if (!name || entry.type !== 'file') return true;
  if (EXCLUDED_BASENAMES.has(name)) return true;
  if (name.endsWith('.json')) return true;
  return false;
}

function isDeletableOverlayPath(repoPath, overlayRoot) {
  const path = normalizeRepoPath(repoPath);
  const root = normalizeRepoPath(overlayRoot);
  if (!path || !root) return false;
  if (!path.startsWith(`${root}/`) && path !== root) return false;
  const base = path.split('/').pop()?.toLowerCase() || '';
  if (EXCLUDED_BASENAMES.has(base)) return false;
  if (base.endsWith('.json')) return false;
  return true;
}

async function listDirSafe(repoPath) {
  try {
    invalidateRepoDirCache(repoPath);
    const entries = await listRepoDir(repoPath);
    return { error: '', entries: Array.isArray(entries) ? entries : [] };
  } catch (err) {
    return { error: String(err?.message || err), entries: [] };
  }
}

async function fetchSnapshotJson(snapDir, name) {
  const url = `${rawGithubUrl(`${snapDir}/${name}`)}?t=${Date.now()}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
  try {
    const res = await trackedRawFetch(url, {
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(await res.text());
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function inferKindFromPath(path) {
  const p = normalizeRepoPath(path).toLowerCase();
  if (p.includes('/characters/')) return 'character';
  if (p.includes('/scene-cuts/')) return 'sceneCut';
  if (p.includes('/stories/')) return 'story';
  if (p.includes('/files/')) return 'file';
  if (/wallpaper\.(png|jpe?g|webp)$/i.test(p)) return 'wallpaper';
  return 'other';
}

function buildByKind(entries) {
  /** @type {Record<string, { count: number, bytes: number, label: string }>} */
  const byKind = {};
  for (const key of Object.keys(KIND_LABELS)) {
    byKind[key] = { count: 0, bytes: 0, label: KIND_LABELS[key] };
  }
  for (const item of entries) {
    if (!byKind[item.kind]) {
      byKind[item.kind] = { count: 0, bytes: 0, label: KIND_LABELS[item.kind] || item.kind };
    }
    byKind[item.kind].count += 1;
    byKind[item.kind].bytes += item.size;
  }
  return byKind;
}

/**
 * @param {string} overlayRoot
 * @param {{ report?: (label: string) => void, errors?: string[] }} [ctx]
 * @returns {Promise<OrphanAssetEntry[]>}
 */
async function collectOverlayInventory(overlayRoot, ctx = {}) {
  const report = typeof ctx.report === 'function' ? ctx.report : () => {};
  const errors = Array.isArray(ctx.errors) ? ctx.errors : [];
  /** @type {OrphanAssetEntry[]} */
  const inventory = [];

  const dirs = [
    { path: `${overlayRoot}/characters`, kind: 'character' },
    { path: `${overlayRoot}/scene-cuts`, kind: 'sceneCut' },
    { path: `${overlayRoot}/stories`, kind: 'story' },
    { path: `${overlayRoot}/files`, kind: 'file' },
  ];

  for (const dir of dirs) {
    report(`목록: ${dir.path}`);
    const listed = await listDirSafe(dir.path);
    if (listed.error) {
      if (!/404|Not Found|없/i.test(listed.error)) {
        errors.push(`${dir.path}: ${listed.error}`);
      }
      continue;
    }
    for (const entry of listed.entries) {
      if (shouldSkipInventoryFile(entry)) continue;
      const path = normalizeRepoPath(entry.path || `${dir.path}/${entry.name}`);
      inventory.push({
        path,
        name: entry.name,
        kind: dir.kind,
        kindLabel: KIND_LABELS[dir.kind] || dir.kind,
        size: Number(entry.size) || 0,
      });
    }
  }

  report(`목록: ${overlayRoot} (월페이퍼)`);
  const overlayRootListed = await listDirSafe(overlayRoot);
  if (!overlayRootListed.error) {
    for (const entry of overlayRootListed.entries) {
      if (shouldSkipInventoryFile(entry)) continue;
      const path = normalizeRepoPath(entry.path || `${overlayRoot}/${entry.name}`);
      if (!/wallpaper\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
      inventory.push({
        path,
        name: entry.name,
        kind: 'wallpaper',
        kindLabel: KIND_LABELS.wallpaper,
        size: Number(entry.size) || 0,
      });
    }
  }

  return inventory;
}

function normalizeSnapshotId(id) {
  return String(id || '').trim().replace(/\.json$/i, '');
}

/**
 * 프로젝트(스냅샷) 범위 분석 권한 — 마스터 또는 해당 스냅샷 삭제 가능 관리자.
 * @param {string[]} snapshotIds
 */
async function assertCanAnalyzeProjectScoped(snapshotIds) {
  const user = getCurrentUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (user.role === ROLES.USER) {
    throw new Error('일반 사용자는 고아 자산 분석을 사용할 수 없습니다.');
  }
  if (isMaster(user)) return;

  const ids = snapshotIds.map(normalizeSnapshotId).filter(Boolean);
  const [detailed, defaultMeta] = await Promise.all([
    listGithubProjectsDetailed(),
    fetchGithubDefaultMeta({ fresh: true }),
  ]);
  const defaultSnapshotId = normalizeSnapshotId(
    defaultMeta?.snapshotId || defaultMeta?.filename || ''
  );

  for (const id of ids) {
    const snap = detailed.find((s) => normalizeSnapshotId(s.snapshotId) === id);
    if (!snap) throw new Error(`스냅샷을 찾을 수 없습니다: ${id}`);
    if (!canDeleteGithubProjectSnapshot(snap, user, defaultSnapshotId)) {
      throw new Error(`이 프로젝트의 고아 자산 분석 권한이 없습니다: ${snap.title || id}`);
    }
  }
}

export { KIND_LABELS, formatBytes };

/**
 * GitHub overlays 자산 중 어떤 스냅샷에서도 참조되지 않는 파일을 분석한다.
 * 분석만 수행하며 삭제하지 않는다. (마스터 전용)
 * @param {{ onProgress?: (p: { label: string }) => void }} [options]
 * @returns {Promise<OrphanAnalysisResult>}
 */
export async function analyzeOrphanGithubAssets(options = {}) {
  if (!isMaster()) {
    throw new Error('고아 자산 분석은 마스터만 사용할 수 있습니다.');
  }

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const report = (label) => {
    if (onProgress) onProgress({ label });
  };

  const cfg = getGithubConfig();
  const snapDir = snapshotsDir(cfg);
  const overlayRoot = overlaysDir(cfg);
  const errors = [];

  report('스냅샷 목록 조회 중…');
  const snapshots = await listGithubProjectSnapshots();
  const referenced = new Set();

  for (let i = 0; i < snapshots.length; i += 1) {
    const snap = snapshots[i];
    report(`참조 수집 ${i + 1}/${snapshots.length} · ${snap.name}`);
    try {
      const data = await fetchSnapshotJson(snapDir, snap.name);
      collectPathsFromSnapshot(data, referenced);
    } catch (err) {
      errors.push(`${snap.name}: ${err?.message || err}`);
    }
  }

  report('오버레이 파일 목록 수집 중…');
  const inventory = await collectOverlayInventory(overlayRoot, { report, errors });

  const orphans = inventory
    .filter((item) => !referenced.has(item.path))
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));

  const byKind = buildByKind(orphans);
  let orphanBytes = 0;
  for (const item of orphans) orphanBytes += item.size;

  report(`분석 완료 · 고아 후보 ${orphans.length}개`);

  return {
    snapshotCount: snapshots.length,
    referencedCount: referenced.size,
    inventoryCount: inventory.length,
    orphanCount: orphans.length,
    orphanBytes,
    byKind,
    orphans,
    referencedPaths: [...referenced].sort(),
    inventoryPaths: inventory.map((i) => i.path).sort(),
    errors,
  };
}

/**
 * 삭제 대상 스냅샷만 참조하고, 다른 스냅샷에서는 참조되지 않는 파일을 분석한다.
 * 삭제하지 않으며, 마스터 또는 해당 스냅샷 삭제 권한이 있는 관리자가 사용할 수 있다.
 * @param {string[]} snapshotIds
 * @param {{ onProgress?: (p: { label: string }) => void }} [options]
 * @returns {Promise<ProjectScopedOrphanResult>}
 */
export async function analyzeProjectScopedOrphans(snapshotIds, options = {}) {
  const targetIds = [...new Set((snapshotIds || []).map(normalizeSnapshotId).filter(Boolean))];
  if (!targetIds.length) throw new Error('분석할 스냅샷을 지정하세요.');

  await assertCanAnalyzeProjectScoped(targetIds);

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const report = (label) => {
    if (onProgress) onProgress({ label });
  };

  const cfg = getGithubConfig();
  const snapDir = snapshotsDir(cfg);
  const overlayRoot = overlaysDir(cfg);
  const errors = [];
  const targetIdSet = new Set(targetIds);

  report('스냅샷 목록 조회 중…');
  const snapshots = await listGithubProjectSnapshots();
  const targetSnaps = snapshots.filter((s) => targetIdSet.has(normalizeSnapshotId(s.snapshotId)));
  const otherSnaps = snapshots.filter((s) => !targetIdSet.has(normalizeSnapshotId(s.snapshotId)));

  if (!targetSnaps.length) {
    throw new Error('삭제 대상 스냅샷을 저장소에서 찾지 못했습니다.');
  }

  const targetRefs = new Set();
  const otherRefs = new Set();

  for (let i = 0; i < targetSnaps.length; i += 1) {
    const snap = targetSnaps[i];
    report(`대상 참조 ${i + 1}/${targetSnaps.length} · ${snap.name}`);
    try {
      const data = await fetchSnapshotJson(snapDir, snap.name);
      collectPathsFromSnapshot(data, targetRefs);
    } catch (err) {
      errors.push(`${snap.name}: ${err?.message || err}`);
    }
  }

  for (let i = 0; i < otherSnaps.length; i += 1) {
    const snap = otherSnaps[i];
    report(`다른 스냅샷 참조 ${i + 1}/${otherSnaps.length} · ${snap.name}`);
    try {
      const data = await fetchSnapshotJson(snapDir, snap.name);
      collectPathsFromSnapshot(data, otherRefs);
    } catch (err) {
      errors.push(`${snap.name}: ${err?.message || err}`);
    }
  }

  report('오버레이 파일 목록 수집 중…');
  const inventory = await collectOverlayInventory(overlayRoot, { report, errors });
  const inventoryByPath = new Map(inventory.map((item) => [item.path, item]));

  /** @type {OrphanAssetEntry[]} */
  const projectOnly = [];
  for (const path of targetRefs) {
    if (otherRefs.has(path)) continue;
    if (!isDeletableOverlayPath(path, overlayRoot)) continue;
    const known = inventoryByPath.get(path);
    if (known) {
      projectOnly.push(known);
      continue;
    }
    const kind = inferKindFromPath(path);
    projectOnly.push({
      path,
      name: path.split('/').pop() || path,
      kind,
      kindLabel: KIND_LABELS[kind] || kind,
      size: 0,
    });
  }

  projectOnly.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
  const byKind = buildByKind(projectOnly);
  let projectOnlyBytes = 0;
  for (const item of projectOnly) projectOnlyBytes += item.size;

  report(`프로젝트 전용 후보 ${projectOnly.length}개`);

  return {
    targetSnapshotIds: targetIds,
    targetSnapshotCount: targetSnaps.length,
    otherSnapshotCount: otherSnaps.length,
    targetRefCount: targetRefs.size,
    otherRefCount: otherRefs.size,
    projectOnlyCount: projectOnly.length,
    projectOnlyBytes,
    byKind,
    projectOnly,
    errors,
  };
}

/**
 * 선택한 고아 자산을 한 커밋으로 삭제한다.
 * 삭제 직전 최신 분석으로 재검증해, 아직 참조되는 경로는 거부한다.
 * @param {string[]} repoPaths
 * @param {{ onProgress?: (p: { label: string }) => void }} [options]
 */
export async function deleteOrphanGithubAssets(repoPaths, options = {}) {
  if (!isMaster()) {
    throw new Error('고아 자산 삭제는 마스터만 사용할 수 있습니다.');
  }
  if (!hasGithubToken()) {
    throw new Error('GitHub Personal Access Token이 필요합니다. 우측 패널에서 연결하세요.');
  }

  const requested = [...new Set(
    (repoPaths || []).map((p) => normalizeRepoPath(p)).filter(Boolean)
  )];
  if (!requested.length) throw new Error('삭제할 고아 자산을 선택하세요.');

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const report = (label) => {
    if (onProgress) onProgress({ label });
  };

  const cfg = getGithubConfig();
  const overlayRoot = overlaysDir(cfg);

  for (const path of requested) {
    if (!isDeletableOverlayPath(path, overlayRoot)) {
      throw new Error(`삭제할 수 없는 경로입니다: ${path}`);
    }
  }

  return runWithGithubSyncLock('orphan-delete', async () => {
    report('삭제 전 고아 여부 재검증 중…');
    const analysis = await analyzeOrphanGithubAssets({
      onProgress: (p) => report(p?.label || '재검증 중…'),
    });
    const orphanSet = new Set(analysis.orphans.map((o) => o.path));
    const stillReferenced = requested.filter((path) => !orphanSet.has(path));
    if (stillReferenced.length) {
      throw new Error(
        `아직 스냅샷에서 참조 중인 파일은 삭제할 수 없습니다.\n\n${stillReferenced.slice(0, 8).join('\n')}`
        + (stillReferenced.length > 8 ? '\n…' : '')
      );
    }

    const existing = [];
    for (const path of requested) {
      report(`존재 확인 · ${path.split('/').pop()}`);
      try {
        if (await repoPathExists(path)) existing.push(path);
      } catch {
        existing.push(path);
      }
    }
    if (!existing.length) {
      return {
        deleted: requested,
        deletedCount: requested.length,
        commitSha: '',
        alreadyAbsent: true,
        analysis,
      };
    }

    report(`${existing.length}개 파일 삭제 커밋 중…`);
    const commit = await deleteRepoPaths(
      existing,
      `NovelExplor: delete orphan assets (${existing.length})`
    );

    for (const dir of [
      `${overlayRoot}/characters`,
      `${overlayRoot}/scene-cuts`,
      `${overlayRoot}/stories`,
      `${overlayRoot}/files`,
      overlayRoot,
    ]) {
      invalidateRepoDirCache(dir);
    }

    return {
      deleted: existing,
      deletedCount: existing.length,
      commitSha: commit.commitSha,
      alreadyAbsent: false,
      analysis,
    };
  });
}
