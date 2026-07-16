/** 프로젝트 삭제 시 고아 자산 분석·선택 정리 플로우 */

import { getCurrentUser, isMaster } from '../core/auth.js';
import {
  analyzeProjectScopedOrphans,
  deleteOrphanGithubAssets,
  formatBytes,
} from '../core/orphan-assets.js';
import {
  appendOrphanCleanupHistory,
} from '../core/orphan-cleanup-history.js';

/**
 * @param {import('../core/orphan-assets.js').ProjectScopedOrphanResult} analysis
 * @param {number} [maxLines]
 */
function formatProjectOnlyPreview(analysis, maxLines = 12) {
  const items = analysis?.projectOnly || [];
  if (!items.length) return '(없음)';
  const lines = items.slice(0, maxLines).map((item) => (
    `· [${item.kindLabel}] ${item.path} (${formatBytes(item.size)})`
  ));
  if (items.length > maxLines) lines.push(`… 외 ${items.length - maxLines}개`);
  return lines.join('\n');
}

/**
 * 스냅샷 삭제 confirm 직후 호출.
 * 분석 여부와(마스터만) 자동 삭제 여부를 묻고, 스냅샷 삭제 전에 미리보기를 보여준다.
 * 자동 삭제는 기본 OFF — 마스터가 두 번째 confirm을 수락해야 한다.
 *
 * @param {string[]} snapshotIds
 * @param {{
 *   labels?: string[],
 *   onProgress?: (p: { label: string }) => void,
 * }} [options]
 * @returns {Promise<{
 *   analyzed: boolean,
 *   autoDelete: boolean,
 *   paths: string[],
 *   analysis: import('../core/orphan-assets.js').ProjectScopedOrphanResult | null,
 *   restricted: boolean,
 * }>}
 */
export async function offerOrphanCleanupOnProjectDelete(snapshotIds, options = {}) {
  const ids = [...new Set((snapshotIds || []).map((id) => String(id || '').replace(/\.json$/i, '')).filter(Boolean))];
  if (!ids.length) {
    return { analyzed: false, autoDelete: false, paths: [], analysis: null, restricted: false };
  }

  const master = isMaster();
  const analyzeOk = confirm(
    '삭제 전에 고아 자산도 분석할까요?\n\n'
    + '· 이 프로젝트만 참조하던 파일을 미리 보여 줍니다.\n'
    + '· 자동 삭제는 기본으로 꺼져 있습니다.\n'
    + (master
      ? '· 마스터는 미리보기 후 선택적으로 함께 삭제할 수 있습니다.'
      : '· 권한 관리자는 미리보기만 가능하며, 자동 삭제는 마스터만 할 수 있습니다.')
  );
  if (!analyzeOk) {
    return { analyzed: false, autoDelete: false, paths: [], analysis: null, restricted: !master };
  }

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const analysis = await analyzeProjectScopedOrphans(ids, {
    onProgress,
  });

  const labels = Array.isArray(options.labels) ? options.labels : ids;
  const user = getCurrentUser();
  const preview = formatProjectOnlyPreview(analysis);

  if (!analysis.projectOnlyCount) {
    alert('이 프로젝트만 참조하던 파일은 없습니다.\n(다른 스냅샷과 공유 중이거나 참조 자산이 없습니다.)');
    await appendOrphanCleanupHistory({
      userId: user?.id || '',
      username: user?.username || '',
      role: user?.role || '',
      trigger: 'project-delete',
      snapshotIds: ids,
      snapshotLabels: labels,
      analyzed: true,
      projectOnlyCount: 0,
      deletedCount: 0,
      autoDelete: false,
      restricted: !master,
      note: '프로젝트 전용 고아 없음',
    });
    return { analyzed: true, autoDelete: false, paths: [], analysis, restricted: !master };
  }

  if (!master) {
    alert(
      `이 프로젝트만 참조하던 파일 ${analysis.projectOnlyCount}개`
      + ` · ${formatBytes(analysis.projectOnlyBytes)}\n\n${preview}\n\n`
      + '자동 삭제는 마스터만 허용됩니다.\n'
      + '미리보기만 표시했으며, 파일은 삭제되지 않습니다.'
    );
    await appendOrphanCleanupHistory({
      userId: user?.id || '',
      username: user?.username || '',
      role: user?.role || '',
      trigger: 'project-delete',
      snapshotIds: ids,
      snapshotLabels: labels,
      analyzed: true,
      projectOnlyCount: analysis.projectOnlyCount,
      deletedCount: 0,
      deletedPaths: analysis.projectOnly.map((p) => p.path),
      autoDelete: false,
      restricted: true,
      note: '관리자 미리보기(자동 삭제 제한)',
    });
    return {
      analyzed: true,
      autoDelete: false,
      paths: [],
      analysis,
      restricted: true,
    };
  }

  const wantDelete = confirm(
    `이 프로젝트만 참조하던 파일 ${analysis.projectOnlyCount}개`
    + ` · ${formatBytes(analysis.projectOnlyBytes)}\n\n${preview}\n\n`
    + '스냅샷 삭제 후 위 파일도 함께 삭제할까요?\n\n'
    + '※ 자동 삭제는 기본 OFF입니다.\n'
    + '※ [확인]을 눌러야만 삭제됩니다. [취소]하면 스냅샷만 삭제합니다.'
  );

  return {
    analyzed: true,
    autoDelete: wantDelete,
    paths: wantDelete ? analysis.projectOnly.map((p) => p.path) : [],
    analysis,
    restricted: false,
  };
}

/**
 * 스냅샷 삭제 성공 후, 마스터가 선택한 고아 자산을 삭제하고 이력을 남긴다.
 *
 * @param {{
 *   snapshotIds: string[],
 *   labels?: string[],
 *   offer: Awaited<ReturnType<typeof offerOrphanCleanupOnProjectDelete>>,
 *   onProgress?: (p: { label: string }) => void,
 * }} args
 */
export async function finalizeOrphanCleanupAfterSnapshotDelete(args) {
  const offer = args.offer;
  const ids = args.snapshotIds || [];
  const labels = args.labels || ids;
  const user = getCurrentUser();
  const master = isMaster();

  if (!offer?.analyzed) return null;

  if (!offer.autoDelete || !offer.paths?.length) {
    if (master && offer.analyzed && offer.analysis?.projectOnlyCount && !offer.autoDelete) {
      await appendOrphanCleanupHistory({
        userId: user?.id || '',
        username: user?.username || '',
        role: user?.role || '',
        trigger: 'project-delete',
        snapshotIds: ids,
        snapshotLabels: labels,
        analyzed: true,
        projectOnlyCount: offer.analysis.projectOnlyCount,
        deletedCount: 0,
        deletedPaths: offer.analysis.projectOnly.map((p) => p.path),
        autoDelete: false,
        restricted: false,
        note: '분석만 수행(자동 삭제 OFF)',
      });
    }
    return null;
  }

  if (!master) {
    throw new Error('고아 자산 자동 삭제는 마스터만 사용할 수 있습니다.');
  }

  const deleted = await deleteOrphanGithubAssets(offer.paths, {
    onProgress: args.onProgress,
  });

  await appendOrphanCleanupHistory({
    userId: user?.id || '',
    username: user?.username || '',
    role: user?.role || '',
    trigger: 'project-delete',
    snapshotIds: ids,
    snapshotLabels: labels,
    analyzed: true,
    projectOnlyCount: offer.analysis?.projectOnlyCount || offer.paths.length,
    deletedCount: deleted.deletedCount,
    deletedPaths: deleted.deleted || offer.paths,
    commitSha: deleted.commitSha || '',
    autoDelete: true,
    restricted: false,
    note: deleted.alreadyAbsent ? '이미 없는 파일' : '프로젝트 삭제 연동 정리',
  });

  return deleted;
}
