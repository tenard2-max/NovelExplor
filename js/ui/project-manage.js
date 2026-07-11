/** 마스터 프로젝트 관리
 * 상단: 관리자(소설가·개발자) 1명 선택
 * 하단: 선택 가능한 프로젝트 목록 (로컬 + 동기화 폴더 + GitHub)
 * 저장: 선택한 관리자에게 체크된 프로젝트 쓰기 권한 부여/해제
 */

import { listUsers, canBeProjectWriter, normalizeWriters, normalizeWriterNames, isMaster, ROLE_LABELS } from '../core/auth.js';
import { listProjects, applyAdminWriteAccess, loadProject, getCurrentProject } from '../core/project.js';
import {
  listGithubProjectsDetailed,
  listGithubProjectSnapshots,
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
      const built = await buildProjectCatalog();
      catalog = built.items;
      const nLocal = catalog.filter((c) => c.localId).length;
      const nGh = catalog.filter((c) => c.ghSnapshotId).length;
      const nFolder = catalog.filter((c) => c.folderName).length;
      const folderNote = hasSyncDir()
        ? `폴더(${getSyncFolderLabel() || '연결됨'}) ${nFolder}`
        : '폴더 미연결';
      let line = `${catalog.length}개 프로젝트 · 로컬 ${nLocal} · GitHub ${nGh} · ${folderNote}`;
      if (built.githubError) {
        line += ` · GitHub오류: ${built.githubError}`;
      } else if (built.githubListed > nGh) {
        line += ` · 원격파일 ${built.githubListed}(동일 작품 병합 ${nGh})`;
      }
      if (!hasGithubToken()) {
        line += ' · GitHub 삭제는 PAT 필요';
      }
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

      const checked = [...listEl.querySelectorAll('input[name="proj-item"]:checked')];
      // dataset 뿐 아니라 catalog.key 로 localId 해석 (속성 누락·이스케이프 대비)
      const grantLocal = [];
      const ghOnlyChecked = [];
      for (const el of checked) {
        const item = catalog.find((c) => c.key === el.value);
        const localId = item?.localId || el.getAttribute('data-local-id') || el.dataset.localId || '';
        if (localId) grantLocal.push(localId);
        else if (item?.ghSnapshotId || el.dataset.ghId) ghOnlyChecked.push(el);
      }

      const allLocalIds = catalog.map((c) => c.localId).filter(Boolean);
      const grantSet = new Set(grantLocal);
      const revokeLocal = allLocalIds.filter((id) => !grantSet.has(id));

      if (!grantLocal.length && checked.length) {
        alert(
          '체크한 항목에 이 브라우저 로컬 프로젝트가 없습니다.\n'
          + '쓰기 권한은 「로컬」 배지가 있는 프로젝트에만 적용됩니다.\n'
          + '먼저 해당 프로젝트를 「이 브라우저」로 연 뒤 다시 시도하세요.'
        );
        return;
      }

      if (!grantLocal.length && !revokeLocal.length) {
        alert('적용할 로컬 프로젝트가 없습니다.');
        return;
      }

      if (ghOnlyChecked.length) {
        const okOpen = confirm(
          `체크한 항목 중 ${ghOnlyChecked.length}개는 로컬이 없어 권한 적용 대상에서 제외됩니다.\n`
          + `로컬 ${grantLocal.length}개만 적용할까요?`
        );
        if (!okOpen) return;
      }

      confirmBtn.disabled = true;
      statusEl.textContent = '권한 저장 중…';
      try {
        const result = await applyAdminWriteAccess(adminId, grantLocal, revokeLocal);
        const { changed, projectIds, errors = [], granted = 0, revoked = 0 } = result;

        if (errors.length) {
          console.warn('[project-manage] ACL 오류:', errors);
        }

        const cur = getCurrentProject();
        const curId = cur?.id || cur?.projectId;
        // 부여된 프로젝트가 열려 있으면 JSON/폴더에도 ACL 반영
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
        const admin = admins.find((u) => u.id === adminId);
        const errLine = errors.length
          ? `\n\n오류 ${errors.length}건:\n${errors.slice(0, 5).join('\n')}`
          : '';
        alert(
          `${admin?.username || '관리자'} 쓰기 권한 반영\n`
          + `부여 ${granted} · 해제 ${revoked} · 변경 ${changed}\n`
          + `체크(로컬) ${grantLocal.length} · 해제 대상 ${revokeLocal.length}`
          + errLine
          + `\n\n같은 브라우저에서 해당 계정으로 다시 로그인하세요.\n`
          + `다른 PC는 저장(JSON/GitHub) 후 그 파일로 열어야 합니다.`
        );

        if (!granted && grantLocal.length && errors.length) {
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
 *   localId: string,
 *   ghSnapshotId: string,
 *   folderName: string,
 *   fileHint: string,
 *   latestLabel: string,
 *   latestStamp: string,
 *   isDefault: boolean,
 * }} ProjectCatalogItem
 */

/** 로컬 + 폴더 + GitHub 를 제목·owner 기준으로 합침
 * @returns {Promise<{ items: ProjectCatalogItem[], githubError: string, githubListed: number }>}
 */
async function buildProjectCatalog() {
  /** @type {Map<string, ProjectCatalogItem>} */
  const byKey = new Map();
  let githubError = '';
  let githubListed = 0;

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

  // GitHub 먼저 — 폴더 JSON 대량 읽기보다 앞서 원격 목록을 확정 (이전엔 폴더 뒤에 두다 실패를 삼킴)
  let defaultId = '';
  try {
    const def = await fetchGithubDefaultMeta();
    defaultId = def?.snapshotId || '';
  } catch { /* */ }

  /** @type {Awaited<ReturnType<typeof listGithubProjectsDetailed>>} */
  let snaps = [];
  try {
    // 1) 디렉터리 목록만 먼저 (성공하면 최소한 파일명으로라도 표시 가능)
    const lite = await listGithubProjectSnapshots();
    githubListed = lite.length;
    snaps = lite.map((s) => ({
      ...s,
      title: s.label || s.name,
      author: '',
      writers: [],
      writerUsernames: [],
      ownerId: '',
      exportedAt: '',
    }));

    // 2) 메타 보강 (실패해도 위에서 넣은 항목 유지)
    if (lite.length) {
      try {
        const detailed = await listGithubProjectsDetailed();
        const byId = new Map(detailed.map((d) => [d.snapshotId, d]));
        snaps = lite.map((s) => {
          const d = byId.get(s.snapshotId);
          return d || {
            ...s,
            title: s.label || s.name,
            author: '',
            writers: [],
            writerUsernames: [],
            ownerId: '',
            exportedAt: '',
          };
        });
      } catch (metaErr) {
        console.warn('[project-manage] GitHub 메타 보강 실패(목록은 유지):', metaErr);
        githubError = `메타 보강 실패: ${metaErr?.message || metaErr}`;
      }
    }
  } catch (err) {
    console.warn('[project-manage] GitHub 목록 실패:', err);
    githubError = err?.message || String(err);
    snaps = [];
    githubListed = 0;
  }

  for (const s of snaps) {
    const mk = projectMergeKey(s.title, s.ownerId, `gh:${s.snapshotId}`);
    let matched = byKey.get(mk);
    if (!matched) {
      for (const item of byKey.values()) {
        if (sameProject(item.title, item.author, s.title, s.author)) {
          matched = item;
          break;
        }
      }
    }
    // 같은 원격 작품은 더 최신 스냅샷만 대표로 유지
    if (matched?.ghSnapshotId && matched.ghSnapshotId !== s.snapshotId) {
      if (s.snapshotId <= matched.ghSnapshotId) continue;
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
      // 메타로 제목이 좋아지면 키는 그대로 두되 표시 제목만 갱신
      if (s.title && s.title !== s.name && s.title !== s.label) {
        matched.title = s.title;
      }
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
          if (!prev.author && author) prev.author = author;
        } else {
          // 제목만 같은 GitHub 항목과 합치기
          let matchedGh = null;
          for (const item of byKey.values()) {
            if (item.ghSnapshotId && sameProject(item.title, item.author, title, author)) {
              matchedGh = item;
              break;
            }
          }
          if (matchedGh) {
            matchedGh.folderName = f.name;
            if (!matchedGh.fileHint) matchedGh.fileHint = f.name;
            if (f.stamp > (matchedGh.latestStamp || '')) {
              matchedGh.latestStamp = f.stamp;
              matchedGh.latestLabel = f.label;
            }
            if (!matchedGh.writers.length && writers.length) matchedGh.writers = writers;
            if (!matchedGh.author && author) matchedGh.author = author;
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
      }
    } catch (err) {
      console.warn('[project-manage] 폴더 목록 실패:', err);
    }
  }

  const items = [...byKey.values()].sort((a, b) =>
    (b.latestStamp || '').localeCompare(a.latestStamp || '')
    || a.title.localeCompare(b.title)
  );
  return { items, githubError, githubListed };
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
