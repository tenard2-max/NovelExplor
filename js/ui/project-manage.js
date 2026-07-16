/** 마스터 프로젝트 관리
 * 상단: 쓰기 권한을 줄 관리자(소설가·개발자) 1명 선택
 * 하단: 로컬 IDB · GitHub 스냅샷을 각각 전부 나열 후 체크 → 권한 적용
 */

import { listUsers, canBeProjectWriter, normalizeWriters, normalizeWriterNames, isMaster, ROLE_LABELS } from '../core/auth.js';
import { listProjects, applyAdminWriteAccess, loadProject, getCurrentProject } from '../core/project.js';
import {
  listGithubProjectsDetailed,
  listGithubProjectSnapshots,
  deleteGithubProjectSnapshots,
  fetchGithubDefaultMeta,
  isGithubRateLimitError,
} from '../core/default-project.js';
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
      const result = await deleteGithubProjectSnapshots(ids);
      await refreshCatalog();
      const details = [`GitHub ${result.deletedCount || result.deleted.length}개 삭제 완료`];
      if (result.latestUpdated) {
        details.push(result.latestTarget ? `latest → ${result.latestTarget}` : 'latest 포인터 제거');
      }
      if (result.defaultUpdated) {
        details.push(result.defaultTarget ? `기본 → ${result.defaultTarget}` : '기본 포인터 제거');
      }
      statusEl.textContent = `${details.join(' · ')} · ${statusEl.textContent}`;
    } catch (err) {
      const message = String(err?.message || err);
      const guidance = /동기화 충돌|fast.?forward|먼저 갱신/i.test(message)
        ? ' 다른 저장 작업과 충돌했습니다. 목록을 새로고침한 뒤 다시 시도하세요.'
        : /권한|마스터|일반 사용자/i.test(message)
          ? ' GitHub 최신 메타 기준으로 권한이 거부되었습니다.'
          : '';
      alert(`삭제 실패: ${message}${guidance}`);
      await refreshCatalog();
      statusEl.textContent = `삭제 실패: ${message}${guidance} · ${statusEl.textContent}`;
      updateActionButtons();
    }
  });

  updateActionButtons();
  refreshCatalog();

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
