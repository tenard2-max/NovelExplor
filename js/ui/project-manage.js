/** 마스터 프로젝트 관리
 * 상단: 쓰기 권한을 줄 관리자(소설가·개발자) 1명 선택
 * 하단: 로컬 IDB · GitHub 스냅샷을 각각 전부 나열 후 체크 → 권한 적용
 */

import { listUsers, canBeProjectWriter, normalizeWriters, normalizeWriterNames, isMaster, getCurrentUser, ROLE_LABELS } from '../core/auth.js';
import {
  listProjects,
  applyAdminWriteAccess,
  loadProject,
  getCurrentProject,
  setCurrentProjectTitle,
} from '../core/project.js';
import * as storage from '../core/storage.js';
import { nowIso } from '../core/utils.js';
import {
  listGithubProjectsDetailed,
  listGithubProjectSnapshots,
  deleteGithubProjectSnapshots,
  fetchGithubDefaultMeta,
  isGithubRateLimitError,
  canDeleteGithubProjectSnapshot,
} from '../core/default-project.js';
import {
  analyzeOrphanGithubAssets,
  deleteOrphanGithubAssets,
  formatBytes as formatOrphanBytes,
  ORPHAN_FILTERS,
} from '../core/orphan-assets.js';
import {
  listOrphanCleanupHistory,
  formatCleanupHistoryTime,
  appendOrphanCleanupHistory,
} from '../core/orphan-cleanup-history.js';
import {
  listProjectTitleHistory,
  appendProjectTitleHistory,
  formatTitleHistoryTime,
} from '../core/project-title-history.js';
import { titleFilenameHint } from '../core/project-display.js';
import {
  offerOrphanCleanupOnProjectDelete,
  finalizeOrphanCleanupAfterSnapshotDelete,
} from './project-delete-orphan-flow.js';
import { hasGithubToken, getGithubConfig, snapshotsDir } from '../core/github-config.js';
import { getRepoFileJson, commitRepoFiles } from '../core/github-api.js';
import {
  initSyncFolder,
  hasSyncDir,
  listTimestampBackups,
  readBackupFile,
  writeBackupToSyncFolder,
} from '../core/sync-folder.js';
import { exportTimestampedBackup } from '../core/backup.js';
import { flushSave } from '../core/autosave.js';
import { applyRolePermissions } from './permissions.js';

/**
 * @returns {Promise<boolean>} 권한 적용 여부
 */
export async function showProjectManageDialog() {
  if (!isMaster()) {
    alert('마스터만 프로젝트 관리를 사용할 수 있습니다.');
    return false;
  }

  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const form = dialog.querySelector('.dialog-form');
  const cancelBtn = document.getElementById('dialog-cancel');
  const confirmBtn = document.getElementById('dialog-confirm');
  const loadBtn = document.getElementById('open-proj-load-btn');
  if (loadBtn) loadBtn.hidden = true;

  dialog.classList.add('dialog-wide');
  titleEl.textContent = '프로젝트 관리';
  confirmBtn.textContent = '권한 적용';
  confirmBtn.disabled = true;

  const users = await listUsers();
  const admins = users.filter((u) => canBeProjectWriter(u));

  bodyEl.innerHTML = `
    <div class="proj-manage">
      <section class="proj-manage-section">
        <h3 class="proj-manage-h">관리자 선택</h3>
        <p class="proj-manage-hint">
          아래에 체크한 프로젝트에 <strong>쓰기 권한을 줄</strong> 소설가·개발자를
          <strong>한 명</strong> 고릅니다. (마스터는 항상 쓰기 가능 · 권한 대상만 선택)
        </p>
        <div class="proj-manage-list" id="proj-admin-list" role="radiogroup" aria-label="관리자">
          ${admins.length
    ? admins.map((u, i) => `
            <label class="proj-manage-row">
              <input type="radio" name="proj-admin" value="${esc(u.id)}" ${i === 0 ? 'checked' : ''}>
              <span class="proj-manage-name">${esc(u.username)}</span>
              <span class="proj-manage-role">${esc(ROLE_LABELS[u.role] || u.role)}</span>
            </label>`).join('')
    : '<p class="proj-manage-empty">등록된 소설가·개발자가 없습니다. 마스터 화면에서 역할을 지정하세요.</p>'}
        </div>
      </section>

      <section class="proj-manage-section">
        <div class="proj-manage-gh-head">
          <h3 class="proj-manage-h">프로젝트 선택</h3>
          <button type="button" class="btn-sm" id="proj-refresh">새로고침</button>
        </div>
        <p class="proj-manage-hint">
          체크 = 위 관리자에게 쓰기 권한.
          <strong>로컬</strong> DB · <strong>폴더</strong> JSON · <strong>GitHub</strong> 스냅샷(PAT)에 바로 반영합니다.
          다운로드만 한 JSON은 목록에 없습니다.
          굵은 글씨 = 프로젝트 제목 · 코드 = 파일명(테마). 제목 수정은 파일명을 바꾸지 않습니다.
        </p>
        <p id="proj-status" class="proj-manage-gh-status">불러오는 중…</p>
        <div id="proj-list" class="proj-manage-project-list" role="list" aria-label="프로젝트"></div>
        <div class="proj-manage-gh-actions">
          <button type="button" class="btn-sm" id="proj-select-all" disabled>전체 선택</button>
          <button type="button" class="btn-sm char-btn-danger" id="proj-gh-delete" disabled>GitHub 선택 삭제</button>
          <button type="button" class="btn-sm" id="proj-orphan-analyze" title="고아 후보 분석 후 선택 삭제">고아 자산 분석</button>
        </div>
        <section id="proj-orphan-panel" class="proj-orphan-panel" hidden>
          <div class="proj-orphan-head">
            <h4 class="proj-orphan-title">고아 자산 정리</h4>
            <p class="proj-orphan-note">
              기본값은 미선택입니다. 원하는 파일만 체크한 뒤 삭제하세요.
              삭제 전 최신 참조를 다시 검사하며, 한 커밋으로 묶여 반영됩니다.
            </p>
          </div>
          <p id="proj-orphan-status" class="proj-manage-gh-status"></p>
          <div id="proj-orphan-summary" class="proj-orphan-summary"></div>
          <div id="proj-orphan-toolbar" class="proj-orphan-toolbar" hidden>
            <div id="proj-orphan-filters" class="proj-orphan-filters" role="group" aria-label="고아 자산 필터"></div>
            <div class="proj-orphan-actions">
              <button type="button" class="btn-sm" id="proj-orphan-select-visible">보이는 항목 선택</button>
              <button type="button" class="btn-sm" id="proj-orphan-clear">선택 해제</button>
              <button type="button" class="btn-sm char-btn-danger" id="proj-orphan-delete" disabled>선택 삭제</button>
            </div>
          </div>
          <div id="proj-orphan-list" class="proj-orphan-list" role="list" aria-label="고아 자산 후보"></div>
        </section>
        <section class="proj-orphan-history">
          <h5 class="proj-orphan-history-title">정리 이력</h5>
          <p class="proj-orphan-note">프로젝트 삭제 연동 분석·정리 기록(이 브라우저). 자동 삭제는 마스터만 가능합니다.</p>
          <div id="proj-orphan-history-list" class="proj-orphan-history-list"></div>
        </section>
        <section class="proj-orphan-history proj-title-history">
          <h5 class="proj-orphan-history-title">제목 변경 이력</h5>
          <p class="proj-orphan-note">프로젝트 관리에서 수정한 제목 기록(이 브라우저). GitHub는 수정 직전 권한을 다시 확인합니다.</p>
          <div id="proj-title-history-list" class="proj-orphan-history-list"></div>
        </section>
      </section>
    </div>`;

  const listEl = bodyEl.querySelector('#proj-list');
  const statusEl = bodyEl.querySelector('#proj-status');
  const refreshBtn = bodyEl.querySelector('#proj-refresh');
  const selectAllBtn = bodyEl.querySelector('#proj-select-all');
  const deleteBtn = bodyEl.querySelector('#proj-gh-delete');
  const orphanBtn = bodyEl.querySelector('#proj-orphan-analyze');
  const orphanPanel = bodyEl.querySelector('#proj-orphan-panel');
  const orphanStatusEl = bodyEl.querySelector('#proj-orphan-status');
  const orphanSummaryEl = bodyEl.querySelector('#proj-orphan-summary');
  const orphanListEl = bodyEl.querySelector('#proj-orphan-list');
  const orphanToolbar = bodyEl.querySelector('#proj-orphan-toolbar');
  const orphanFiltersEl = bodyEl.querySelector('#proj-orphan-filters');
  const orphanSelectVisibleBtn = bodyEl.querySelector('#proj-orphan-select-visible');
  const orphanClearBtn = bodyEl.querySelector('#proj-orphan-clear');
  const orphanDeleteBtn = bodyEl.querySelector('#proj-orphan-delete');
  const orphanHistoryListEl = bodyEl.querySelector('#proj-orphan-history-list');
  const titleHistoryListEl = bodyEl.querySelector('#proj-title-history-list');

  /** @type {ProjectCatalogItem[]} */
  let catalog = [];
  /** @type {Awaited<ReturnType<typeof analyzeOrphanGithubAssets>> | null} */
  let orphanResult = null;
  let orphanFilterId = 'all';
  /** @type {Set<string>} 선택 경로 — 기본 전체 미선택 */
  let orphanSelected = new Set();
  let orphanBusy = false;

  function selectedAdminId() {
    return bodyEl.querySelector('input[name="proj-admin"]:checked')?.value || '';
  }

  function updateActionButtons() {
    const adminId = selectedAdminId();
    confirmBtn.disabled = !adminId || !admins.length;
    const ghChecked = [...listEl.querySelectorAll('input[name="proj-item"]:checked')]
      .filter((el) => el.dataset.ghId);
    deleteBtn.disabled = ghChecked.length === 0;
    selectAllBtn.disabled = catalog.length === 0;
  }

  function syncChecksToAdmin() {
    const adminId = selectedAdminId();
    const admin = admins.find((u) => u.id === adminId);
    const adminName = String(admin?.username || '').toLowerCase();
    listEl.querySelectorAll('input[name="proj-item"]').forEach((el) => {
      const item = catalog.find((c) => c.key === el.value);
      if (!item) return;
      const writers = normalizeWriters(item.writers);
      const names = normalizeWriterNames(item.writerUsernames);
      el.checked = Boolean(
        adminId
        && (writers.includes(adminId) || (adminName && names.includes(adminName)))
      );
    });
    updateActionButtons();
  }

  function renderList() {
    if (!catalog.length) {
      listEl.innerHTML = '<p class="proj-manage-empty">표시할 프로젝트가 없습니다.</p>';
      updateActionButtons();
      return;
    }

    listEl.innerHTML = catalog.map((item) => {
      const badges = [];
      if (item.localId) badges.push('로컬');
      if (item.folderName) badges.push('폴더');
      if (item.ghSnapshotId) badges.push(item.isDefault ? 'GitHub·기본' : 'GitHub');
      const meta = [
        item.author ? `작성 ${item.author}` : '',
        item.latestLabel || '',
        badges.join(' · '),
      ].filter(Boolean).join(' · ');
      const mismatch = item.fileHint
        ? titleFilenameHint(item.title || '', item.fileHint)
        : '';

      return `
        <div class="proj-manage-card" role="listitem">
          <label class="proj-manage-card-check">
            <input type="checkbox" name="proj-item" value="${esc(item.key)}"
              data-local-id="${esc(item.localId || '')}"
              data-gh-id="${esc(item.ghSnapshotId || '')}">
          </label>
          <span class="proj-manage-card-body">
            <strong class="proj-manage-card-title">${esc(item.title)}</strong>
            ${item.fileHint ? `<code class="proj-manage-card-file">${esc(item.fileHint)}</code>` : ''}
            ${mismatch ? `<small class="proj-manage-title-mismatch">${esc(mismatch)}</small>` : ''}
            <small class="proj-manage-card-meta">${esc(meta)}</small>
          </span>
          <button type="button" class="btn-sm proj-manage-rename" data-key="${esc(item.key)}"
            title="프로젝트 제목(project.title) 수정 · 파일명은 그대로">제목 수정</button>
        </div>`;
    }).join('');

    listEl.querySelectorAll('input[name="proj-item"]').forEach((el) => {
      el.addEventListener('change', updateActionButtons);
    });
    listEl.querySelectorAll('.proj-manage-rename').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = catalog.find((c) => c.key === btn.dataset.key);
        if (item) renameCatalogItemTitle(item);
      });
    });
    syncChecksToAdmin();
  }

  /**
   * 목록 항목의 project.title 수정 (로컬 / 폴더 / GitHub)
   * @param {ProjectCatalogItem} item
   */
  async function renameCatalogItemTitle(item) {
    if (!item) return;
    if (!isMaster()) {
      alert('프로젝트 제목 수정은 마스터만 사용할 수 있습니다.');
      return;
    }

    const raw = prompt(
      '프로젝트 제목 수정\n\n· 1~80자\n· 파일명(테마)은 바뀌지 않습니다.',
      item.title || ''
    );
    if (raw === null) return;

    const validated = validateProjectTitleInput(raw);
    if (!validated.ok) {
      alert(validated.error);
      return;
    }
    const title = validated.title;
    if (title === String(item.title || '').trim()) {
      statusEl.textContent = '제목이 동일하여 변경하지 않았습니다.';
      return;
    }

    if (item.ghSnapshotId && !hasGithubToken()) {
      alert('GitHub 스냅샷 제목을 수정하려면 PAT가 필요합니다.');
      return;
    }

    const renameBtn = [...listEl.querySelectorAll('.proj-manage-rename')]
      .find((btn) => btn.dataset.key === item.key);
    if (renameBtn) renameBtn.disabled = true;
    statusEl.textContent = `제목 수정 중… ${item.fileHint || item.title}`;
    /** @type {string[]} */
    const done = [];
    /** @type {string[]} */
    const errors = [];
    let commitSha = '';
    const previousTitle = item.title || '';

    try {
      if (item.localId) {
        try {
          await renameLocalProjectTitle(item.localId, title);
          done.push('로컬');
        } catch (err) {
          errors.push(`로컬: ${formatTitleRenameError(err)}`);
        }
      }

      if (item.ghSnapshotId) {
        try {
          statusEl.textContent = 'GitHub 권한·메타 확인 중…';
          const ghResult = await renameGithubSnapshotTitle(item, title);
          done.push('GitHub');
          commitSha = ghResult?.commitSha || '';
        } catch (err) {
          errors.push(`GitHub: ${formatTitleRenameError(err)}`);
        }
      }

      if (item.folderName) {
        try {
          const folderResult = await renameFolderBackupTitle(item.folderName, title);
          if (folderResult.error) errors.push(`폴더: ${folderResult.error}`);
          else done.push('폴더');
        } catch (err) {
          errors.push(`폴더: ${formatTitleRenameError(err)}`);
        }
      }

      if (!done.length && !errors.length) {
        errors.push('수정할 저장소를 찾지 못했습니다.');
      }

      if (done.length) {
        const user = getCurrentUser();
        try {
          await appendProjectTitleHistory({
            userId: user?.id || '',
            username: user?.username || '',
            role: user?.role || '',
            previousTitle,
            nextTitle: title,
            targets: done,
            localId: item.localId || '',
            ghSnapshotId: item.ghSnapshotId || '',
            folderName: item.folderName || '',
            fileHint: item.fileHint || '',
            commitSha,
            note: errors.length ? `부분 성공 · ${errors.slice(0, 2).join(' / ')}` : '',
          });
        } catch {
          /* 이력 실패는 무시 */
        }
      }

      await refreshCatalog();
      await renderTitleHistory();
      const shaHint = commitSha ? ` · ${String(commitSha).slice(0, 7)}` : '';
      const errLine = errors.length ? ` · 오류: ${errors.slice(0, 2).join(' / ')}` : '';
      statusEl.textContent = done.length
        ? `제목 수정 완료(${done.join(', ')}) → ${title}${shaHint}${errLine}`
        : `제목 수정 실패${errLine}`;
      if (errors.length && !done.length) {
        alert(`제목 수정 실패\n\n${errors.join('\n')}`);
      } else if (errors.length) {
        alert(`제목 일부만 반영되었습니다.\n\n성공: ${done.join(', ')}\n\n${errors.join('\n')}`);
      }
    } finally {
      if (renameBtn) renameBtn.disabled = false;
      updateActionButtons();
    }
  }

  async function renderTitleHistory() {
    if (!titleHistoryListEl) return;
    try {
      const entries = await listProjectTitleHistory();
      if (!entries.length) {
        titleHistoryListEl.innerHTML = '<p class="proj-manage-empty">제목 변경 이력이 없습니다.</p>';
        return;
      }
      titleHistoryListEl.innerHTML = entries.slice(0, 12).map((entry) => {
        const who = entry.username || entry.userId || 'unknown';
        const targets = (entry.targets || []).join(', ') || '대상 없음';
        const file = entry.fileHint || entry.ghSnapshotId || entry.folderName || entry.localId || '';
        const sha = entry.commitSha ? ` · ${String(entry.commitSha).slice(0, 7)}` : '';
        const note = entry.note ? ` · ${entry.note}` : '';
        return `
          <div class="proj-orphan-history-row">
            <span class="proj-orphan-history-time">${esc(formatTitleHistoryTime(entry.at))}</span>
            <span class="proj-orphan-history-body">
              <strong>${esc(entry.previousTitle || '(없음)')}</strong>
              → <strong>${esc(entry.nextTitle || '')}</strong>
              · ${esc(targets)}${esc(sha)}
              · ${esc(who)}${file ? ` · ${esc(file)}` : ''}${esc(note)}
            </span>
          </div>`;
      }).join('');
    } catch (err) {
      titleHistoryListEl.innerHTML = `<p class="proj-manage-empty">이력 로드 실패: ${esc(err?.message || err)}</p>`;
    }
  }

  async function refreshCatalog() {
    statusEl.textContent = '프로젝트 목록을 모으는 중…';
    refreshBtn.disabled = true;
    try {
      const built = await buildProjectCatalog();
      catalog = built.items;
      const nLocal = catalog.filter((c) => c.localId).length;
      const nGh = catalog.filter((c) => c.ghSnapshotId).length;
      const nFolder = catalog.filter((c) => c.folderName && !c.localId && !c.ghSnapshotId).length;
      let line = `표시 ${catalog.length}개 · 로컬 ${nLocal} · GitHub ${nGh}`;
      if (nFolder) line += ` · 폴더만 ${nFolder}`;
      if (built.githubError) line += ` · GitHub오류: ${built.githubError}`;
      if (!hasGithubToken()) line += ' · PAT 미연결(한도 60/시)';
      statusEl.textContent = line;
      renderList();
    } catch (err) {
      catalog = [];
      listEl.innerHTML = '';
      statusEl.textContent = `목록 실패: ${err.message || err}`;
      updateActionButtons();
    } finally {
      refreshBtn.disabled = false;
    }
  }

  bodyEl.querySelectorAll('input[name="proj-admin"]').forEach((el) => {
    el.addEventListener('change', syncChecksToAdmin);
  });

  refreshBtn.addEventListener('click', () => { refreshCatalog(); });

  selectAllBtn.addEventListener('click', () => {
    const boxes = [...listEl.querySelectorAll('input[name="proj-item"]')];
    const allOn = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allOn; });
    updateActionButtons();
  });

  deleteBtn.addEventListener('click', async () => {
    const ids = [...listEl.querySelectorAll('input[name="proj-item"]:checked')]
      .map((el) => el.dataset.ghId)
      .filter(Boolean);
    if (!ids.length) return;
    if (!hasGithubToken()) {
      alert('GitHub 삭제에는 PAT가 필요합니다.');
      return;
    }
    const names = ids.map((id) => {
      const c = catalog.find((x) => x.ghSnapshotId === id);
      return c ? `${c.title} (${c.fileHint || id})` : id;
    });
    if (!confirm(`GitHub 스냅샷 ${ids.length}개를 삭제할까요?\n\n${names.join('\n')}`)) return;
    deleteBtn.disabled = true;
    statusEl.textContent = 'GitHub 삭제 중…';
    try {
      let orphanOffer = {
        analyzed: false,
        autoDelete: false,
        paths: [],
        analysis: null,
        restricted: false,
      };
      try {
        orphanOffer = await offerOrphanCleanupOnProjectDelete(ids, {
          labels: names,
          onProgress: ({ label }) => {
            if (label) statusEl.textContent = label;
          },
        });
      } catch (orphanErr) {
        const msg = String(orphanErr?.message || orphanErr);
        if (!confirm(`고아 자산 분석에 실패했습니다.\n${msg}\n\n스냅샷 삭제만 계속할까요?`)) {
          updateActionButtons();
          return;
        }
      }

      statusEl.textContent = 'GitHub 스냅샷 삭제 중…';
      const result = await deleteGithubProjectSnapshots(ids, {
        onProgress: ({ label }) => {
          if (label) statusEl.textContent = label;
        },
      });

      let orphanCleanupNote = '';
      if (orphanOffer.autoDelete && orphanOffer.paths.length) {
        try {
          statusEl.textContent = '고아 자산 정리 중…';
          const cleaned = await finalizeOrphanCleanupAfterSnapshotDelete({
            snapshotIds: ids,
            labels: names,
            offer: orphanOffer,
            onProgress: ({ label }) => {
              if (label) statusEl.textContent = label;
            },
          });
          if (cleaned) {
            const sha = cleaned.commitSha ? ` · ${String(cleaned.commitSha).slice(0, 7)}` : '';
            orphanCleanupNote = cleaned.alreadyAbsent
              ? `고아 ${cleaned.deletedCount}개 이미 없음`
              : `고아 ${cleaned.deletedCount}개 정리${sha}`;
          }
        } catch (cleanErr) {
          orphanCleanupNote = `고아 정리 실패: ${cleanErr?.message || cleanErr}`;
        }
      } else if (orphanOffer.analyzed) {
        try {
          await finalizeOrphanCleanupAfterSnapshotDelete({
            snapshotIds: ids,
            labels: names,
            offer: orphanOffer,
          });
        } catch {
          /* 이력만 */
        }
        if (orphanOffer.analysis?.projectOnlyCount && !orphanOffer.autoDelete) {
          orphanCleanupNote = `고아 후보 ${orphanOffer.analysis.projectOnlyCount}개(삭제 안 함)`;
        }
      }

      await refreshCatalog();
      await renderOrphanCleanupHistory();
      const details = [
        result.alreadyAbsent
          ? `GitHub ${result.deletedCount || result.deleted.length}개 이미 삭제됨`
          : `GitHub ${result.deletedCount || result.deleted.length}개 삭제 완료`,
      ];
      if (result.latestUpdated) {
        details.push(result.latestTarget ? `latest → ${result.latestTarget}` : 'latest 포인터 제거');
      }
      if (result.defaultUpdated) {
        details.push(result.defaultTarget ? `기본 → ${result.defaultTarget}` : '기본 포인터 제거');
      }
      if (orphanCleanupNote) details.push(orphanCleanupNote);
      statusEl.textContent = `${details.join(' · ')} · ${statusEl.textContent}`;
    } catch (err) {
      const message = String(err?.message || err);
      const guidance = /동기화 충돌|fast.?forward|먼저 갱신/i.test(message)
        ? ' 같은 main에 앱 푸시·다른 저장/삭제가 겹쳤습니다. 목록 새로고침 후 다시 시도하세요.'
        : /네트워크 연결 실패|Failed to fetch|타임아웃|끊겼/i.test(message)
          ? ' 연결이 끊겼습니다. 목록을 새로고침해 삭제 여부를 확인하세요.'
          : /권한|마스터|일반 사용자/i.test(message)
            ? ' GitHub 최신 메타 기준으로 권한이 거부되었습니다.'
            : '';
      alert(`삭제 실패: ${message}${guidance}`);
      await refreshCatalog();
      statusEl.textContent = `삭제 실패: ${message}${guidance} · ${statusEl.textContent}`;
      updateActionButtons();
    }
  });

  async function renderOrphanCleanupHistory() {
    if (!orphanHistoryListEl) return;
    try {
      const entries = await listOrphanCleanupHistory();
      if (!entries.length) {
        orphanHistoryListEl.innerHTML = '<p class="proj-manage-empty">정리 이력이 없습니다.</p>';
        return;
      }
      orphanHistoryListEl.innerHTML = entries.slice(0, 12).map((entry) => {
        const who = entry.username || entry.userId || 'unknown';
        const snap = (entry.snapshotLabels || entry.snapshotIds || []).slice(0, 2).join(', ')
          || '(스냅샷)';
        const more = (entry.snapshotIds || []).length > 2
          ? ` 외 ${(entry.snapshotIds.length - 2)}개`
          : '';
        const action = entry.autoDelete
          ? `삭제 ${entry.deletedCount}개`
          : entry.restricted
            ? '미리보기만'
            : entry.analyzed
              ? `분석 ${entry.projectOnlyCount}개`
              : '기록';
        const sha = entry.commitSha ? ` · ${String(entry.commitSha).slice(0, 7)}` : '';
        const note = entry.note ? ` · ${entry.note}` : '';
        return `
          <div class="proj-orphan-history-row">
            <span class="proj-orphan-history-time">${esc(formatCleanupHistoryTime(entry.at))}</span>
            <span class="proj-orphan-history-body">
              <strong>${esc(action)}</strong>${esc(sha)}
              · ${esc(who)} · ${esc(snap)}${esc(more)}${esc(note)}
            </span>
          </div>`;
      }).join('');
    } catch (err) {
      orphanHistoryListEl.innerHTML = `<p class="proj-manage-empty">이력 로드 실패: ${esc(err?.message || err)}</p>`;
    }
  }
  function getOrphanFilter() {
    return ORPHAN_FILTERS.find((f) => f.id === orphanFilterId) || ORPHAN_FILTERS[0];
  }

  function getVisibleOrphans() {
    const orphans = orphanResult?.orphans || [];
    const filter = getOrphanFilter();
    if (!filter.kinds) return orphans;
    const kindSet = new Set(filter.kinds);
    return orphans.filter((item) => kindSet.has(item.kind));
  }

  function syncOrphanSelectionToResult() {
    if (!orphanResult?.orphans?.length) {
      orphanSelected = new Set();
      return;
    }
    const valid = new Set(orphanResult.orphans.map((o) => o.path));
    orphanSelected = new Set([...orphanSelected].filter((p) => valid.has(p)));
  }

  function updateOrphanDeleteButton() {
    if (!orphanDeleteBtn) return;
    const n = orphanSelected.size;
    orphanDeleteBtn.disabled = orphanBusy || n === 0;
    orphanDeleteBtn.textContent = n ? `선택 삭제 (${n})` : '선택 삭제';
  }

  function setOrphanBusy(busy) {
    orphanBusy = busy;
    if (orphanBtn) orphanBtn.disabled = busy;
    if (orphanSelectVisibleBtn) orphanSelectVisibleBtn.disabled = busy || !getVisibleOrphans().length;
    if (orphanClearBtn) orphanClearBtn.disabled = busy || orphanSelected.size === 0;
    updateOrphanDeleteButton();
    orphanFiltersEl?.querySelectorAll('button[data-orphan-filter]').forEach((btn) => {
      btn.disabled = busy;
    });
    orphanListEl?.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.disabled = busy;
    });
  }

  function renderOrphanFilters() {
    if (!orphanFiltersEl) return;
    orphanFiltersEl.innerHTML = ORPHAN_FILTERS.map((f) => {
      const count = f.kinds
        ? (orphanResult?.orphans || []).filter((o) => f.kinds.includes(o.kind)).length
        : (orphanResult?.orphanCount || 0);
      const active = f.id === orphanFilterId ? ' is-active' : '';
      return `<button type="button" class="btn-sm proj-orphan-filter${active}" data-orphan-filter="${esc(f.id)}">${esc(f.label)} (${count})</button>`;
    }).join('');
  }

  function renderOrphanList() {
    if (!orphanListEl) return;
    const visible = getVisibleOrphans();
    if (!orphanResult?.orphans?.length) {
      orphanListEl.innerHTML = '<p class="proj-manage-empty">고아 후보가 없습니다. 모든 오버레이 파일이 최소 하나의 스냅샷에서 참조됩니다.</p>';
      if (orphanToolbar) orphanToolbar.hidden = true;
      updateOrphanDeleteButton();
      return;
    }
    if (orphanToolbar) orphanToolbar.hidden = false;
    if (!visible.length) {
      orphanListEl.innerHTML = '<p class="proj-manage-empty">이 필터에 해당하는 고아 후보가 없습니다.</p>';
      updateOrphanDeleteButton();
      return;
    }
    orphanListEl.innerHTML = visible.map((item) => {
      const checked = orphanSelected.has(item.path) ? ' checked' : '';
      return `
      <label class="proj-orphan-row" role="listitem">
        <input type="checkbox" class="proj-orphan-check" data-orphan-path="${esc(item.path)}"${checked}${orphanBusy ? ' disabled' : ''}>
        <span class="proj-orphan-kind-badge">${esc(item.kindLabel)}</span>
        <code class="proj-orphan-path">${esc(item.path)}</code>
        <span class="proj-orphan-size">${esc(formatOrphanBytes(item.size))}</span>
      </label>`;
    }).join('');
    updateOrphanDeleteButton();
  }

  function renderOrphanAnalysis(result, { resetSelection = true } = {}) {
    if (!orphanPanel || !orphanSummaryEl || !orphanListEl) return;
    orphanPanel.hidden = false;
    orphanResult = result;
    if (resetSelection) orphanSelected = new Set();
    else syncOrphanSelectionToResult();

    const kindRows = Object.entries(result.byKind || {})
      .filter(([, v]) => v.count > 0)
      .map(([key, v]) => `
        <div class="proj-orphan-kind">
          <strong>${esc(v.label || key)}</strong>
          <span>${v.count}개 · ${esc(formatOrphanBytes(v.bytes))}</span>
        </div>`)
      .join('');

    orphanSummaryEl.innerHTML = `
      <div class="proj-orphan-stats">
        <span>스냅샷 ${result.snapshotCount}개</span>
        <span>참조 경로 ${result.referencedCount}개</span>
        <span>검사 파일 ${result.inventoryCount}개</span>
        <span class="proj-orphan-stat-warn">고아 후보 ${result.orphanCount}개 · ${esc(formatOrphanBytes(result.orphanBytes))}</span>
      </div>
      <div class="proj-orphan-kinds">${kindRows || '<p class="proj-manage-empty">종류별 후보 없음</p>'}</div>
      ${result.errors?.length
    ? `<p class="proj-orphan-errors">경고 ${result.errors.length}건: ${esc(result.errors.slice(0, 3).join(' · '))}${result.errors.length > 3 ? ' …' : ''}</p>`
    : ''}`;

    renderOrphanFilters();
    renderOrphanList();
    setOrphanBusy(orphanBusy);
  }

  async function runOrphanAnalysis({ resetSelection = true, statusPrefix = '고아 자산 분석' } = {}) {
    if (orphanPanel) orphanPanel.hidden = false;
    if (orphanStatusEl) orphanStatusEl.textContent = `${statusPrefix} 중…`;
    if (orphanSummaryEl && resetSelection) orphanSummaryEl.innerHTML = '';
    if (orphanListEl && resetSelection) orphanListEl.innerHTML = '';
    if (orphanToolbar && resetSelection) orphanToolbar.hidden = true;
    statusEl.textContent = `${statusPrefix} 중…`;
    const result = await analyzeOrphanGithubAssets({
      onProgress: ({ label }) => {
        if (orphanStatusEl && label) orphanStatusEl.textContent = label;
        if (label) statusEl.textContent = label;
      },
    });
    renderOrphanAnalysis(result, { resetSelection });
    const doneMsg = result.orphanCount
      ? `${statusPrefix} 완료 · 고아 후보 ${result.orphanCount}개 (기본 미선택)`
      : `${statusPrefix} 완료 · 고아 후보 없음`;
    if (orphanStatusEl) orphanStatusEl.textContent = doneMsg;
    statusEl.textContent = doneMsg;
    return result;
  }

  orphanFiltersEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-orphan-filter]');
    if (!btn || orphanBusy) return;
    orphanFilterId = btn.getAttribute('data-orphan-filter') || 'all';
    renderOrphanFilters();
    renderOrphanList();
    setOrphanBusy(false);
  });

  orphanListEl?.addEventListener('change', (e) => {
    const input = e.target.closest('input.proj-orphan-check');
    if (!input) return;
    const path = input.getAttribute('data-orphan-path');
    if (!path) return;
    if (input.checked) orphanSelected.add(path);
    else orphanSelected.delete(path);
    updateOrphanDeleteButton();
    if (orphanClearBtn) orphanClearBtn.disabled = orphanBusy || orphanSelected.size === 0;
  });

  orphanSelectVisibleBtn?.addEventListener('click', () => {
    if (orphanBusy) return;
    for (const item of getVisibleOrphans()) orphanSelected.add(item.path);
    renderOrphanList();
    setOrphanBusy(false);
  });

  orphanClearBtn?.addEventListener('click', () => {
    if (orphanBusy) return;
    orphanSelected = new Set();
    renderOrphanList();
    setOrphanBusy(false);
  });

  orphanDeleteBtn?.addEventListener('click', async () => {
    if (orphanBusy || !orphanSelected.size) return;
    const paths = [...orphanSelected];
    const preview = paths.slice(0, 12).map((p) => `· ${p}`).join('\n');
    const more = paths.length > 12 ? `\n… 외 ${paths.length - 12}개` : '';
    if (!confirm(
      `선택한 고아 자산 ${paths.length}개를 GitHub에서 삭제할까요?\n\n`
      + '삭제 전 최신 참조를 다시 검사하며, 한 커밋으로 반영됩니다.\n\n'
      + `${preview}${more}`
    )) return;

    setOrphanBusy(true);
    if (orphanStatusEl) orphanStatusEl.textContent = '고아 자산 삭제 중…';
    statusEl.textContent = '고아 자산 삭제 중…';
    try {
      const deleted = await deleteOrphanGithubAssets(paths, {
        onProgress: ({ label }) => {
          if (orphanStatusEl && label) orphanStatusEl.textContent = label;
          if (label) statusEl.textContent = label;
        },
      });
      const shaHint = deleted.commitSha ? ` · ${String(deleted.commitSha).slice(0, 7)}` : '';
      if (orphanStatusEl) {
        orphanStatusEl.textContent = deleted.alreadyAbsent
          ? `이미 없는 파일 ${deleted.deletedCount}개 · 목록 갱신 중…`
          : `삭제 완료 ${deleted.deletedCount}개${shaHint} · 목록 갱신 중…`;
      }
      statusEl.textContent = orphanStatusEl?.textContent || '고아 자산 삭제 완료';
      orphanSelected = new Set();
      const user = getCurrentUser();
      try {
        await appendOrphanCleanupHistory({
          userId: user?.id || '',
          username: user?.username || '',
          role: user?.role || '',
          trigger: 'manual-orphan-delete',
          snapshotIds: [],
          snapshotLabels: [],
          analyzed: true,
          projectOnlyCount: paths.length,
          deletedCount: deleted.deletedCount,
          deletedPaths: deleted.deleted || paths,
          commitSha: deleted.commitSha || '',
          autoDelete: true,
          restricted: false,
          note: deleted.alreadyAbsent ? '수동 정리 · 이미 없음' : '수동 고아 정리',
        });
      } catch {
        /* 이력 실패는 무시 */
      }
      await runOrphanAnalysis({ resetSelection: true, statusPrefix: '삭제 후 재분석' });
      if (orphanStatusEl) {
        const remain = orphanResult?.orphanCount || 0;
        orphanStatusEl.textContent = deleted.alreadyAbsent
          ? `대상이 이미 없었습니다 · 남은 고아 ${remain}개`
          : `삭제 ${deleted.deletedCount}개 완료${shaHint} · 남은 고아 ${remain}개`;
      }
      statusEl.textContent = orphanStatusEl?.textContent || '고아 자산 정리 완료';
      await renderOrphanCleanupHistory();
    } catch (err) {
      const message = String(err?.message || err);
      alert(`고아 자산 삭제 실패: ${message}`);
      if (orphanStatusEl) orphanStatusEl.textContent = `삭제 실패: ${message}`;
      statusEl.textContent = `고아 자산 삭제 실패: ${message}`;
      try {
        await runOrphanAnalysis({ resetSelection: false, statusPrefix: '삭제 실패 후 재분석' });
      } catch {
        /* 재분석 실패는 무시 — 삭제 오류가 우선 */
      }
    } finally {
      setOrphanBusy(false);
      updateActionButtons();
    }
  });

  orphanBtn?.addEventListener('click', async () => {
    if (orphanBusy) return;
    setOrphanBusy(true);
    try {
      await runOrphanAnalysis({ resetSelection: true, statusPrefix: '고아 자산 분석' });
      await renderOrphanCleanupHistory();
    } catch (err) {
      const message = String(err?.message || err);
      alert(`고아 자산 분석 실패: ${message}`);
      if (orphanStatusEl) orphanStatusEl.textContent = `분석 실패: ${message}`;
      statusEl.textContent = `고아 자산 분석 실패: ${message}`;
    } finally {
      setOrphanBusy(false);
      updateActionButtons();
    }
  });

  updateActionButtons();
  refreshCatalog();
  renderOrphanCleanupHistory();
  renderTitleHistory();

  return new Promise((resolve) => {
    let settled = false;
    const prevConfirmType = confirmBtn.type;
    // method=dialog 폼이 비동기 저장 전에 닫히는 것을 막기 위해 button 으로 처리
    confirmBtn.type = 'button';

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onApply);
      form.removeEventListener('submit', onFormSubmit);
      confirmBtn.type = prevConfirmType || 'submit';
      dialog.classList.remove('dialog-wide');
      confirmBtn.textContent = '확인';
      confirmBtn.disabled = false;
      dialog.close();
      resolve(ok);
    };

    const onCancel = () => finish(false);
    const onFormSubmit = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onApply = async () => {
      const adminId = selectedAdminId();
      if (!adminId) {
        alert('관리자를 선택하세요.');
        return;
      }
      const admin = admins.find((u) => u.id === adminId);
      if (!admin) {
        alert('선택한 관리자를 찾을 수 없습니다.');
        return;
      }

      const checked = [...listEl.querySelectorAll('input[name="proj-item"]:checked')];
      const grantLocal = [];
      /** @type {string[]} 폴더 JSON 파일명 */
      const grantFolderFiles = [];
      /** @type {{ snapshotId: string, name: string }[]} */
      const grantGithub = [];

      for (const el of checked) {
        const item = catalog.find((c) => c.key === el.value);
        const localId = item?.localId || el.getAttribute('data-local-id') || el.dataset.localId || '';
        const ghId = item?.ghSnapshotId || el.dataset.ghId || '';
        const folderFile = item?.folderName || '';
        if (localId) {
          grantLocal.push(localId);
        }
        if (ghId) {
          grantGithub.push({
            snapshotId: ghId,
            name: item?.fileHint || `${ghId}.json`,
          });
        } else if (folderFile) {
          grantFolderFiles.push(folderFile);
        }
      }

      // 로컬: 체크된 것만 grant, 나머지 로컬은 revoke
      const allLocalIds = catalog.map((c) => c.localId).filter(Boolean);
      const grantSet = new Set(grantLocal);
      const revokeLocal = allLocalIds.filter((id) => !grantSet.has(id));

      if (!grantLocal.length && !grantFolderFiles.length && !grantGithub.length && !revokeLocal.length) {
        alert('적용할 항목이 없습니다. 로컬·폴더·GitHub 항목을 체크하세요.');
        return;
      }

      if (grantGithub.length && !hasGithubToken()) {
        alert(
          'GitHub 스냅샷에 권한을 쓰려면 우측 패널에 PAT가 필요합니다.\n'
          + '토큰을 저장한 뒤 다시 「권한 적용」하세요.'
        );
        return;
      }

      confirmBtn.disabled = true;
      statusEl.textContent = '권한 저장 중…';
      try {
        let granted = 0;
        let revoked = 0;
        let changed = 0;
        /** @type {string[]} */
        let projectIds = [];
        /** @type {string[]} */
        let errors = [];

        if (grantLocal.length || revokeLocal.length) {
          const result = await applyAdminWriteAccess(adminId, grantLocal, revokeLocal);
          granted += result.granted || 0;
          revoked += result.revoked || 0;
          changed += result.changed || 0;
          projectIds = result.projectIds || [];
          errors = [...(result.errors || [])];
        }

        let folderPatched = 0;
        if (grantFolderFiles.length) {
          statusEl.textContent = '폴더 JSON 권한 저장 중…';
          const folderResult = await patchFolderWriters(grantFolderFiles, admin, true);
          folderPatched = folderResult.patched;
          errors.push(...folderResult.errors);
        }

        let githubPatched = 0;
        if (grantGithub.length) {
          statusEl.textContent = 'GitHub 스냅샷 권한 저장 중…';
          const ghResult = await patchGithubWriters(grantGithub, admin, true);
          githubPatched = ghResult.patched;
          errors.push(...ghResult.errors);
        }

        const cur = getCurrentProject();
        const curId = cur?.id || cur?.projectId;
        if (curId && (projectIds.includes(curId) || grantLocal.includes(curId))) {
          await loadProject(curId);
          await flushSave(true);
          try {
            await exportTimestampedBackup({ notify: false });
          } catch (err) {
            console.warn('[project-manage] 권한 반영 후 동기화 저장 실패:', err);
          }
        }
        applyRolePermissions();

        const errLine = errors.length
          ? `\n\n오류 ${errors.length}건:\n${errors.slice(0, 5).join('\n')}`
          : '';
        alert(
          `${admin.username || '관리자'} 쓰기 권한 반영\n`
          + `로컬 부여 ${granted} · 로컬 해제 ${revoked} · 로컬 변경 ${changed}\n`
          + `폴더 ${folderPatched} · GitHub ${githubPatched}\n`
          + `체크(로컬 ${grantLocal.length} · 폴더 ${grantFolderFiles.length} · GitHub ${grantGithub.length})`
          + errLine
          + `\n\n같은 브라우저에서 해당 계정으로 다시 로그인하세요.`
        );

        const anyTarget = grantLocal.length || grantFolderFiles.length || grantGithub.length;
        if (!granted && !folderPatched && !githubPatched && anyTarget && errors.length) {
          statusEl.textContent = `권한 저장 실패: ${errors[0]}`;
          confirmBtn.disabled = false;
          return;
        }

        await refreshCatalog();
        finish(true);
      } catch (err) {
        alert(err.message || String(err));
        statusEl.textContent = `권한 적용 실패: ${err.message || err}`;
        confirmBtn.disabled = false;
      }
    };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onApply);
    form.addEventListener('submit', onFormSubmit);
    dialog.showModal();
  });
}

/**
 * @typedef {{
 *   key: string,
 *   title: string,
 *   author: string,
 *   writers: string[],
 *   writerUsernames?: string[],
 *   localId: string,
 *   ghSnapshotId: string,
 *   folderName: string,
 *   fileHint: string,
 *   latestLabel: string,
 *   latestStamp: string,
 *   isDefault: boolean,
 * }} ProjectCatalogItem
 */

/** 로컬 IDB · GitHub 스냅샷 · 폴더를 각각 별도 행으로 나열 (제목 병합 없음)
 * @returns {Promise<{ items: ProjectCatalogItem[], githubError: string, githubListed: number }>}
 */
async function buildProjectCatalog() {
  /** @type {ProjectCatalogItem[]} */
  const items = [];
  let githubError = '';
  let githubListed = 0;

  // 1) 로컬 IndexedDB — id마다 한 행
  const locals = await listProjects();
  for (const p of locals) {
    const id = p.id || p.projectId;
    if (!id) continue;
    items.push({
      key: `local:${id}`,
      title: p.title || '(제목 없음)',
      author: p.author || '',
      writers: normalizeWriters(p.writers),
      writerUsernames: normalizeWriterNames(p.writerUsernames),
      localId: id,
      ghSnapshotId: '',
      folderName: '',
      fileHint: '',
      latestLabel: p.updatedAt
        ? `갱신 ${String(p.updatedAt).slice(0, 19).replace('T', ' ')}`
        : '',
      latestStamp: stampFromIso(p.updatedAt),
      isDefault: false,
    });
  }

  // 2) GitHub — 스냅샷 파일마다 한 행 (합치지 않음)
  let defaultId = '';
  try {
    const def = await fetchGithubDefaultMeta();
    defaultId = def?.snapshotId || '';
  } catch { /* */ }

  try {
    const lite = await listGithubProjectSnapshots();
    githubListed = lite.length;

    /** @type {Map<string, Awaited<ReturnType<typeof listGithubProjectsDetailed>>[0]>} */
    let detailedById = new Map();
    if (lite.length) {
      try {
        const detailed = await listGithubProjectsDetailed();
        detailedById = new Map(detailed.map((d) => [d.snapshotId, d]));
      } catch (metaErr) {
        console.warn('[project-manage] GitHub 메타 보강 실패(목록은 유지):', metaErr);
        if (isGithubRateLimitError(metaErr)) {
          githubError = String(metaErr.message || metaErr);
        } else {
          githubError = `메타 보강 실패: ${metaErr?.message || metaErr}`;
        }
      }
    }

    for (const s of lite) {
      const d = detailedById.get(s.snapshotId);
      items.push({
        key: `gh:${s.snapshotId}`,
        title: d?.title || s.label || s.name,
        author: d?.author || '',
        writers: normalizeWriters(d?.writers),
        writerUsernames: normalizeWriterNames(d?.writerUsernames),
        localId: '',
        ghSnapshotId: s.snapshotId,
        folderName: '',
        fileHint: s.name,
        latestLabel: s.label,
        latestStamp: s.snapshotId.replace(/\D/g, '').slice(0, 14),
        isDefault: Boolean(defaultId && s.snapshotId === defaultId),
      });
    }
  } catch (err) {
    console.warn('[project-manage] GitHub 목록 실패:', err);
    githubError = err?.message || String(err);
    githubListed = 0;
  }

  // 3) 동기화 폴더 — 로컬/GitHub에 없는 파일만 추가 (배지 보강은 파일명 일치 시)
  await initSyncFolder();
  if (hasSyncDir()) {
    try {
      const files = await listTimestampBackups();
      const knownFiles = new Set(
        items.map((c) => c.fileHint || c.folderName).filter(Boolean)
      );
      for (const f of files.slice(0, 60)) {
        // 이미 GitHub/다른 행에 같은 파일명이 있으면 폴더 배지만
        const existing = items.find(
          (c) => c.fileHint === f.name || c.folderName === f.name
          || c.ghSnapshotId && `${c.ghSnapshotId}.json` === f.name
        );
        if (existing) {
          existing.folderName = f.name;
          if (!existing.fileHint) existing.fileHint = f.name;
          continue;
        }
        if (knownFiles.has(f.name)) continue;

        let title = f.name;
        let author = '';
        let writers = [];
        let writerUsernames = [];
        try {
          const file = await readBackupFile(f.handle);
          const data = JSON.parse(await file.text());
          title = data?.project?.title || f.name;
          author = data?.project?.author || '';
          writers = normalizeWriters(data?.project?.writers);
          writerUsernames = normalizeWriterNames(data?.project?.writerUsernames);
        } catch { /* filename only */ }

        items.push({
          key: `folder:${f.name}`,
          title: title || f.name,
          author,
          writers,
          writerUsernames,
          localId: '',
          ghSnapshotId: '',
          folderName: f.name,
          fileHint: f.name,
          latestLabel: f.label,
          latestStamp: f.stamp,
          isDefault: false,
        });
        knownFiles.add(f.name);
      }
    } catch (err) {
      console.warn('[project-manage] 폴더 목록 실패:', err);
    }
  }

  items.sort((a, b) =>
    (b.latestStamp || '').localeCompare(a.latestStamp || '')
    || a.title.localeCompare(b.title)
    || a.key.localeCompare(b.key)
  );
  return { items, githubError, githubListed };
}

/**
 * 동기화 폴더 JSON에 writers / writerUsernames 반영
 * @param {string[]} filenames
 * @param {{ id: string, username: string }} admin
 * @param {boolean} grant true=추가, false=제거
 * @returns {Promise<{ patched: number, errors: string[] }>}
 */
async function patchFolderWriters(filenames, admin, grant) {
  const errors = [];
  let patched = 0;
  if (!filenames?.length) return { patched, errors };
  if (!hasSyncDir()) {
    errors.push('동기화 폴더가 연결되지 않았습니다.');
    return { patched, errors };
  }

  await initSyncFolder();
  const files = await listTimestampBackups();
  const byName = new Map(files.map((f) => [f.name, f]));
  const adminName = String(admin.username || '').trim().toLowerCase();

  for (const name of [...new Set(filenames.filter(Boolean))]) {
    try {
      const entry = byName.get(name);
      if (!entry) {
        errors.push(`폴더에 없음: ${name}`);
        continue;
      }
      const file = await readBackupFile(entry.handle);
      const data = JSON.parse(await file.text());
      if (!data.project || typeof data.project !== 'object') {
        errors.push(`project 없음: ${name}`);
        continue;
      }

      const writerSet = new Set(normalizeWriters(data.project.writers));
      const nameSet = new Set(normalizeWriterNames(data.project.writerUsernames));
      const before = `${[...writerSet].sort().join('|')}::${[...nameSet].sort().join('|')}`;

      if (grant) {
        writerSet.add(admin.id);
        if (adminName) nameSet.add(adminName);
      } else {
        writerSet.delete(admin.id);
        if (adminName) nameSet.delete(adminName);
      }

      data.project.writers = normalizeWriters([...writerSet]);
      data.project.writerUsernames = normalizeWriterNames([...nameSet]);
      const after = `${data.project.writers.slice().sort().join('|')}::${data.project.writerUsernames.slice().sort().join('|')}`;
      if (after === before) {
        patched += 1; // 이미 반영된 경우도 성공으로 카운트
        continue;
      }

      const ok = await writeBackupToSyncFolder(name, JSON.stringify(data, null, 2));
      if (!ok) {
        errors.push(`쓰기 실패: ${name}`);
        continue;
      }
      patched += 1;
    } catch (err) {
      errors.push(`${name}: ${err.message || err}`);
    }
  }
  return { patched, errors };
}

/**
 * GitHub 스냅샷 JSON에 writers 패치 후 PAT로 커밋
 * @param {{ snapshotId: string, name: string }[]} snaps
 * @param {{ id: string, username: string }} admin
 * @param {boolean} grant
 */
async function patchGithubWriters(snaps, admin, grant) {
  const errors = [];
  let patched = 0;
  if (!snaps?.length) return { patched, errors };
  if (!hasGithubToken()) {
    errors.push('GitHub PAT가 필요합니다.');
    return { patched, errors };
  }

  const snapDir = snapshotsDir(getGithubConfig());
  const adminName = String(admin.username || '').trim().toLowerCase();
  /** @type {{ repoPath: string, content: string }[]} */
  const toCommit = [];
  const seen = new Set();

  for (const snap of snaps) {
    const name = String(snap.name || `${snap.snapshotId}.json`).replace(/^.*[\\/]/, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const repoPath = `${snapDir}/${name}`;
    try {
      const data = await getRepoFileJson(repoPath);
      if (!data?.project || typeof data.project !== 'object') {
        errors.push(`project 없음: ${name}`);
        continue;
      }

      const writerSet = new Set(normalizeWriters(data.project.writers));
      const nameSet = new Set(normalizeWriterNames(data.project.writerUsernames));
      const before = `${[...writerSet].sort().join('|')}::${[...nameSet].sort().join('|')}`;

      if (grant) {
        writerSet.add(admin.id);
        if (adminName) nameSet.add(adminName);
      } else {
        writerSet.delete(admin.id);
        if (adminName) nameSet.delete(adminName);
      }

      data.project.writers = normalizeWriters([...writerSet]);
      data.project.writerUsernames = normalizeWriterNames([...nameSet]);
      const after = `${data.project.writers.slice().sort().join('|')}::${data.project.writerUsernames.slice().sort().join('|')}`;
      if (after === before) {
        patched += 1;
        continue;
      }

      toCommit.push({
        repoPath,
        content: JSON.stringify(data, null, 2),
      });
    } catch (err) {
      errors.push(`${name}: ${err.message || err}`);
    }
  }

  if (toCommit.length) {
    try {
      await commitRepoFiles(
        toCommit,
        `NovelExplor: grant write to ${admin.username || admin.id} (${toCommit.length} snapshots)`
      );
      patched += toCommit.length;
    } catch (err) {
      errors.push(`GitHub 커밋 실패: ${err.message || err}`);
    }
  }

  return { patched, errors };
}

const PROJECT_TITLE_MAX = 80;

/**
 * @param {string} raw
 * @returns {{ ok: true, title: string } | { ok: false, error: string }}
 */
function validateProjectTitleInput(raw) {
  const title = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!title) return { ok: false, error: '제목이 비어 있습니다.' };
  if (title.length > PROJECT_TITLE_MAX) {
    return { ok: false, error: `제목은 ${PROJECT_TITLE_MAX}자 이하여야 합니다. (현재 ${title.length}자)` };
  }
  if (/[\u0000-\u001F\u007F]/.test(title)) {
    return { ok: false, error: '제목에 사용할 수 없는 제어 문자가 있습니다.' };
  }
  return { ok: true, title };
}

function formatTitleRenameError(err) {
  const message = String(err?.message || err || '알 수 없는 오류');
  if (/동기화 충돌|fast.?forward|먼저 갱신/i.test(message)) {
    return `${message} — 목록을 새로고침한 뒤 다시 시도하세요.`;
  }
  if (/네트워크|Failed to fetch|타임아웃|끊겼/i.test(message)) {
    return `${message} — 연결을 확인한 뒤 목록을 새로고침하세요.`;
  }
  if (/권한|마스터|PAT|토큰/i.test(message)) {
    return `${message} — GitHub 연결과 권한을 확인하세요.`;
  }
  if (/한도 초과|rate limit/i.test(message)) {
    return `${message} — PAT API 잔량을 확인하세요.`;
  }
  return message;
}

/**
 * @param {string} localId
 * @param {string} title
 */
async function renameLocalProjectTitle(localId, title) {
  const validated = validateProjectTitleInput(title);
  if (!validated.ok) throw new Error(validated.error);
  const id = String(localId || '').trim();
  if (!id) throw new Error('로컬 프로젝트 ID가 없습니다.');
  const record = await storage.get('projects', id);
  if (!record) throw new Error('로컬 프로젝트를 찾을 수 없습니다. 목록을 새로고침하세요.');
  record.title = validated.title;
  record.updatedAt = nowIso();
  await storage.put('projects', record);

  const cur = getCurrentProject();
  const curId = cur?.id || cur?.projectId;
  if (curId && curId === id) {
    setCurrentProjectTitle(validated.title);
    await flushSave(true);
  }
}

/**
 * @param {string} filename
 * @param {string} title
 * @returns {Promise<{ error: string }>}
 */
async function renameFolderBackupTitle(filename, title) {
  const validated = validateProjectTitleInput(title);
  if (!validated.ok) return { error: validated.error };
  const name = String(filename || '').replace(/^.*[\\/]/, '');
  if (!name) return { error: '파일명이 없습니다.' };
  if (!hasSyncDir()) return { error: '동기화 폴더가 연결되지 않았습니다.' };

  await initSyncFolder();
  const files = await listTimestampBackups();
  const entry = files.find((f) => f.name === name);
  if (!entry) return { error: `폴더에 없음: ${name}. 목록을 새로고침하세요.` };

  const file = await readBackupFile(entry.handle);
  const data = JSON.parse(await file.text());
  if (!data.project || typeof data.project !== 'object') {
    return { error: `project 없음: ${name}` };
  }
  if (data.project.title === validated.title
    && (typeof data.title !== 'string' || data.title === validated.title)) {
    return { error: '' };
  }
  data.project.title = validated.title;
  if (typeof data.title === 'string') data.title = validated.title;

  const ok = await writeBackupToSyncFolder(name, JSON.stringify(data, null, 2));
  if (!ok) return { error: `쓰기 실패: ${name}` };
  return { error: '' };
}

/**
 * GitHub 스냅샷 제목 수정 — 최신 메타·권한 재확인 후 1커밋
 * @param {ProjectCatalogItem} item
 * @param {string} title
 * @returns {Promise<{ commitSha: string, unchanged?: boolean }>}
 */
async function renameGithubSnapshotTitle(item, title) {
  const validated = validateProjectTitleInput(title);
  if (!validated.ok) throw new Error(validated.error);
  if (!isMaster()) throw new Error('프로젝트 제목 수정은 마스터만 사용할 수 있습니다.');
  if (!hasGithubToken()) throw new Error('GitHub PAT가 필요합니다.');

  const snapshotId = String(item.ghSnapshotId || '').replace(/\.json$/i, '');
  const name = String(item.fileHint || `${snapshotId}.json`).replace(/^.*[\\/]/, '');
  if (!snapshotId || !name) throw new Error('스냅샷 파일명이 없습니다.');

  const defaultMeta = await fetchGithubDefaultMeta({ fresh: true });
  const defaultSnapshotId = String(
    defaultMeta?.snapshotId || defaultMeta?.filename || ''
  ).replace(/\.json$/i, '');

  const repoPath = `${snapshotsDir(getGithubConfig())}/${name}`;
  let data;
  try {
    data = await getRepoFileJson(repoPath);
  } catch (err) {
    throw new Error(`최신 스냅샷을 읽지 못했습니다: ${err?.message || err}`);
  }
  if (!data?.project || typeof data.project !== 'object') {
    throw new Error(`project 없음: ${name}`);
  }

  const freshSnap = {
    snapshotId,
    name,
    title: data.project.title || item.title || name,
    writers: Array.isArray(data.project.writers) ? data.project.writers : [],
    writerUsernames: Array.isArray(data.project.writerUsernames) ? data.project.writerUsernames : [],
    ownerId: data.project.ownerId || '',
  };
  // 원격 최신 writers/기본 포인터 기준으로 쓰기 가능 여부 재확인 (마스터는 통과)
  if (!canDeleteGithubProjectSnapshot(freshSnap, getCurrentUser(), defaultSnapshotId)) {
    throw new Error('GitHub 최신 메타 기준 쓰기 권한이 없습니다. 목록을 새로고침하세요.');
  }

  if (data.project.title === validated.title
    && (typeof data.title !== 'string' || data.title === validated.title)) {
    return { commitSha: '', unchanged: true };
  }

  data.project.title = validated.title;
  if (typeof data.title === 'string') data.title = validated.title;

  const commit = await commitRepoFiles(
    [{ repoPath, content: JSON.stringify(data, null, 2) }],
    `NovelExplor: rename project title (${name})`
  );
  return { commitSha: commit?.commitSha || '', unchanged: false };
}

function stampFromIso(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
