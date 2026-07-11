/** 마스터 프로젝트 관리
 * 상단: 관리자(소설가·개발자) 1명 선택
 * 하단: 선택 가능한 프로젝트 목록 (로컬 + 동기화 폴더 + GitHub)
 * 저장: 선택한 관리자에게 체크된 프로젝트 쓰기 권한 부여/해제
 */

import { listUsers, canBeProjectWriter, normalizeWriters, normalizeWriterNames, isMaster, ROLE_LABELS } from '../core/auth.js';
import { listProjects, applyAdminWriteAccess, loadProject, getCurrentProject } from '../core/project.js';
import {
  listGithubProjectsDetailed,
  deleteGithubProjectSnapshots,
  fetchGithubDefaultMeta,
} from '../core/default-project.js';
import { hasGithubToken } from '../core/github-config.js';
import {
  initSyncFolder,
  hasSyncDir,
  listTimestampBackups,
  readBackupFile,
  getSyncFolderLabel,
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
          쓰기 권한을 줄 <strong>소설가·개발자</strong>를 한 명 선택하세요. (마스터는 항상 쓰기 가능)
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
          로컬 DB · 연결 폴더 · GitHub 의 프로젝트를 모읍니다.
          체크 = 위 관리자에게 쓰기 권한. 다운로드 폴더만 저장된 JSON은 목록에 나오지 않습니다.
        </p>
        <p id="proj-status" class="proj-manage-gh-status">불러오는 중…</p>
        <div id="proj-list" class="proj-manage-project-list" role="list" aria-label="프로젝트"></div>
        <div class="proj-manage-gh-actions">
          <button type="button" class="btn-sm" id="proj-select-all" disabled>전체 선택</button>
          <button type="button" class="btn-sm char-btn-danger" id="proj-gh-delete" disabled>GitHub 선택 삭제</button>
        </div>
      </section>
    </div>`;

  const listEl = bodyEl.querySelector('#proj-list');
  const statusEl = bodyEl.querySelector('#proj-status');
  const refreshBtn = bodyEl.querySelector('#proj-refresh');
  const selectAllBtn = bodyEl.querySelector('#proj-select-all');
  const deleteBtn = bodyEl.querySelector('#proj-gh-delete');

  /** @type {ProjectCatalogItem[]} */
  let catalog = [];

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

      return `
        <label class="proj-manage-card" role="listitem">
          <input type="checkbox" name="proj-item" value="${esc(item.key)}"
            data-local-id="${esc(item.localId || '')}"
            data-gh-id="${esc(item.ghSnapshotId || '')}">
          <span class="proj-manage-card-body">
            <strong class="proj-manage-card-title">${esc(item.title)}</strong>
            ${item.fileHint ? `<code class="proj-manage-card-file">${esc(item.fileHint)}</code>` : ''}
            <small class="proj-manage-card-meta">${esc(meta)}</small>
          </span>
        </label>`;
    }).join('');

    listEl.querySelectorAll('input[name="proj-item"]').forEach((el) => {
      el.addEventListener('change', updateActionButtons);
    });
    syncChecksToAdmin();
  }

  async function refreshCatalog() {
    statusEl.textContent = '프로젝트 목록을 모으는 중…';
    refreshBtn.disabled = true;
    try {
      catalog = await buildProjectCatalog();
      const nLocal = catalog.filter((c) => c.localId).length;
      const nGh = catalog.filter((c) => c.ghSnapshotId).length;
      const nFolder = catalog.filter((c) => c.folderName).length;
      const folderNote = hasSyncDir()
        ? `폴더(${getSyncFolderLabel() || '연결됨'}) ${nFolder}`
        : '폴더 미연결';
      statusEl.textContent = `${catalog.length}개 프로젝트 · 로컬 ${nLocal} · GitHub ${nGh} · ${folderNote}`;
      if (!hasGithubToken()) {
        statusEl.textContent += ' · GitHub 삭제는 PAT 필요';
      }
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
      await deleteGithubProjectSnapshots(ids);
      await refreshCatalog();
    } catch (err) {
      alert(`삭제 실패: ${err.message || err}`);
      statusEl.textContent = `삭제 실패: ${err.message || err}`;
      updateActionButtons();
    }
  });

  updateActionButtons();
  refreshCatalog();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      dialog.classList.remove('dialog-wide');
      confirmBtn.textContent = '확인';
      confirmBtn.disabled = false;
      dialog.close();
      resolve(ok);
    };

    const onCancel = () => finish(false);
    const onSubmit = async (e) => {
      e.preventDefault();
      const adminId = selectedAdminId();
      if (!adminId) {
        alert('관리자를 선택하세요.');
        return;
      }

      const checked = [...listEl.querySelectorAll('input[name="proj-item"]:checked')];
      const grantLocal = checked.map((el) => el.dataset.localId).filter(Boolean);
      const allLocalIds = catalog.map((c) => c.localId).filter(Boolean);
      const grantSet = new Set(grantLocal);
      const revokeLocal = allLocalIds.filter((id) => !grantSet.has(id));

      const ghOnlyChecked = checked.filter((el) => !el.dataset.localId && el.dataset.ghId);
      if (ghOnlyChecked.length) {
        const okOpen = confirm(
          `체크한 항목 중 ${ghOnlyChecked.length}개는 이 브라우저에 로컬 프로젝트가 없습니다.\n`
          + `쓰기 권한은 로컬에 있는 프로젝트에만 바로 적용됩니다.\n`
          + `계속할까요?`
        );
        if (!okOpen) return;
      }

      try {
        const { changed, projectIds } = await applyAdminWriteAccess(adminId, grantLocal, revokeLocal);
        const cur = getCurrentProject();
        const curId = cur?.id || cur?.projectId;
        if (curId && projectIds.includes(curId)) {
          await loadProject(curId);
          await flushSave(true);
          try {
            await exportTimestampedBackup({ notify: false });
          } catch (err) {
            console.warn('[project-manage] 권한 반영 후 동기화 저장 실패:', err);
          }
        }
        applyRolePermissions();
        const admin = admins.find((u) => u.id === adminId);
        alert(
          `${admin?.username || '관리자'} 쓰기 권한을 반영했습니다. (변경 ${changed}건)\n`
          + `체크됨 ${grantLocal.length} · 해제 ${revokeLocal.length}\n`
          + `같은 브라우저에서 해당 계정으로 다시 로그인하면 바로 적용됩니다.\n`
          + `다른 PC는 프로젝트 저장(JSON/GitHub) 후 그 파일로 열어야 합니다.`
        );
        await refreshCatalog();
        finish(true);
      } catch (err) {
        alert(err.message || String(err));
      }
    };

    cancelBtn.addEventListener('click', onCancel);
    form.addEventListener('submit', onSubmit);
    dialog.showModal();
  });
}

/**
 * @typedef {{
 *   key: string,
 *   title: string,
 *   author: string,
 *   writers: string[],
 *   localId: string,
 *   ghSnapshotId: string,
 *   folderName: string,
 *   fileHint: string,
 *   latestLabel: string,
 *   latestStamp: string,
 *   isDefault: boolean,
 * }} ProjectCatalogItem
 */

/** 로컬 + 폴더 + GitHub 를 제목·owner 기준으로 합침 */
async function buildProjectCatalog() {
  /** @type {Map<string, ProjectCatalogItem>} */
  const byKey = new Map();

  const locals = await listProjects();
  for (const p of locals) {
    const id = p.id || p.projectId;
    const key = projectMergeKey(p.title, p.ownerId, id);
    byKey.set(key, {
      key,
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

  await initSyncFolder();
  if (hasSyncDir()) {
    try {
      const files = await listTimestampBackups();
      for (const f of files.slice(0, 60)) {
        let title = '';
        let author = '';
        let ownerId = '';
        let writers = [];
        try {
          const file = await readBackupFile(f.handle);
          const data = JSON.parse(await file.text());
          title = data?.project?.title || '';
          author = data?.project?.author || '';
          ownerId = data?.project?.ownerId || '';
          writers = normalizeWriters(data?.project?.writers);
        } catch {
          title = f.name;
        }
        const mergeKey = projectMergeKey(title, ownerId, `folder:${f.name}`);
        const prev = byKey.get(mergeKey);
        if (prev) {
          prev.folderName = f.name;
          if (!prev.fileHint) prev.fileHint = f.name;
          if (f.stamp > (prev.latestStamp || '')) {
            prev.latestStamp = f.stamp;
            prev.latestLabel = f.label;
          }
          if (!prev.writers.length && writers.length) prev.writers = writers;
          if (!prev.writerUsernames?.length && writers.length) {
            /* folder peek may not have usernames */
          }
          if (!prev.author && author) prev.author = author;
        } else {
          byKey.set(mergeKey, {
            key: mergeKey,
            title: title || f.name,
            author,
            writers,
            writerUsernames: [],
            localId: '',
            ghSnapshotId: '',
            folderName: f.name,
            fileHint: f.name,
            latestLabel: f.label,
            latestStamp: f.stamp,
            isDefault: false,
          });
        }
      }
    } catch (err) {
      console.warn('[project-manage] 폴더 목록 실패:', err);
    }
  }

  let defaultId = '';
  try {
    const def = await fetchGithubDefaultMeta();
    defaultId = def?.snapshotId || '';
  } catch { /* */ }

  try {
    const snaps = await listGithubProjectsDetailed();
    // 같은 프로젝트는 최신 스냅샷만 대표로 (목록은 프로젝트 단위)
    /** @type {Map<string, typeof snaps[0]>} */
    const latestByProject = new Map();
    for (const s of snaps) {
      const mk = projectMergeKey(s.title, s.ownerId, `gh:${s.snapshotId}`);
      const prev = latestByProject.get(mk);
      if (!prev || s.snapshotId > prev.snapshotId) latestByProject.set(mk, s);
    }

    for (const [mk, s] of latestByProject) {
      // 로컬/폴더와 제목·owner로 합치기
      let matched = byKey.get(mk);
        if (!matched) {
        for (const item of byKey.values()) {
          if (sameProject(item.title, item.author, s.title, s.author)) {
            matched = item;
            break;
          }
        }
      }
      if (matched) {
        matched.ghSnapshotId = s.snapshotId;
        matched.fileHint = matched.fileHint || s.name;
        matched.isDefault = Boolean(defaultId && s.snapshotId === defaultId);
        if (s.snapshotId.replace(/\D/g, '').slice(0, 14) > (matched.latestStamp || '')) {
          matched.latestStamp = s.snapshotId.replace(/\D/g, '').slice(0, 14);
          matched.latestLabel = s.label;
        }
        if (!matched.writers.length) matched.writers = normalizeWriters(s.writers);
        if (!matched.writerUsernames?.length) {
          matched.writerUsernames = normalizeWriterNames(s.writerUsernames);
        }
        if (!matched.author && s.author) matched.author = s.author;
      } else {
        byKey.set(mk, {
          key: mk,
          title: s.title || s.name,
          author: s.author || '',
          writers: normalizeWriters(s.writers),
          writerUsernames: normalizeWriterNames(s.writerUsernames),
          localId: '',
          ghSnapshotId: s.snapshotId,
          folderName: '',
          fileHint: s.name,
          latestLabel: s.label,
          latestStamp: s.snapshotId.replace(/\D/g, '').slice(0, 14),
          isDefault: Boolean(defaultId && s.snapshotId === defaultId),
        });
      }
    }
  } catch (err) {
    console.warn('[project-manage] GitHub 목록 실패:', err);
  }

  return [...byKey.values()].sort((a, b) =>
    (b.latestStamp || '').localeCompare(a.latestStamp || '')
    || a.title.localeCompare(b.title)
  );
}

function projectMergeKey(title, ownerId, fallback) {
  const t = String(title || '').trim().toLowerCase();
  const o = String(ownerId || '').trim();
  if (t && o) return `p:${o}|${t}`;
  if (t) return `t:${t}`;
  return `f:${fallback}`;
}

function sameProject(titleA, authorA, titleB, authorB) {
  const ta = String(titleA || '').trim().toLowerCase();
  const tb = String(titleB || '').trim().toLowerCase();
  if (!ta || !tb || ta !== tb) return false;
  const aa = String(authorA || '').trim().toLowerCase();
  const ab = String(authorB || '').trim().toLowerCase();
  if (aa && ab) return aa === ab;
  return true;
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
