/** 마스터: 전체 프로젝트 목록 + writers + GitHub JSON 삭제 */

import { listUsers, canBeProjectWriter, normalizeWriters, isMaster, ROLE_LABELS } from '../core/auth.js';
import { getCurrentProject, setProjectWriters, listProjects, loadProject } from '../core/project.js';
import {
  listGithubProjectsDetailed,
  deleteGithubProjectSnapshots,
  fetchGithubDefaultMeta,
} from '../core/default-project.js';
import { hasGithubToken } from '../core/github-config.js';
import { applyRolePermissions } from './permissions.js';

/**
 * 프로젝트 관리 다이얼로그 — 모든 GitHub·로컬 프로젝트 표시
 * @returns {Promise<boolean>} writers 저장 여부
 */
export async function showProjectManageDialog() {
  if (!isMaster()) {
    alert('마스터만 프로젝트 관리를 사용할 수 있습니다.');
    return false;
  }

  let proj = getCurrentProject();
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
  confirmBtn.textContent = '쓰기 권한 저장';
  confirmBtn.disabled = !proj;

  const users = await listUsers();
  const admins = users.filter((u) => canBeProjectWriter(u));
  const userNameById = new Map(users.map((u) => [u.id, u.username]));

  bodyEl.innerHTML = `
    <div class="proj-manage">
      <section class="proj-manage-section">
        <div class="proj-manage-gh-head">
          <h3 class="proj-manage-h">모든 프로젝트 (GitHub)</h3>
          <button type="button" class="btn-sm" id="proj-gh-refresh">새로고침</button>
        </div>
        <p class="proj-manage-hint">
          저장소 <code>snapshots/</code> 의 모든 타임스탬프 JSON입니다. 제목·작성자·파일을 확인한 뒤 삭제할 수 있습니다.
        </p>
        <p id="proj-gh-status" class="proj-manage-gh-status">불러오는 중…</p>
        <div id="proj-gh-list" class="proj-manage-project-list" role="list" aria-label="GitHub 프로젝트"></div>
        <div class="proj-manage-gh-actions">
          <button type="button" class="btn-sm" id="proj-gh-select-all" disabled>전체 선택</button>
          <button type="button" class="btn-sm char-btn-danger" id="proj-gh-delete" disabled>선택 삭제</button>
        </div>
      </section>

      <section class="proj-manage-section">
        <h3 class="proj-manage-h">이 브라우저 로컬 프로젝트</h3>
        <p class="proj-manage-hint">IndexedDB에 있는 프로젝트입니다. 행을 클릭하면 열고 writers를 편집할 수 있습니다.</p>
        <div id="proj-local-list" class="proj-manage-project-list" role="list" aria-label="로컬 프로젝트"></div>
      </section>

      <section class="proj-manage-section" id="proj-writers-section">
        <h3 class="proj-manage-h">쓰기 권한 (writers)</h3>
        <div id="proj-writers-body"></div>
      </section>
    </div>`;

  const ghListEl = bodyEl.querySelector('#proj-gh-list');
  const localListEl = bodyEl.querySelector('#proj-local-list');
  const writersBody = bodyEl.querySelector('#proj-writers-body');
  const ghStatusEl = bodyEl.querySelector('#proj-gh-status');
  const refreshBtn = bodyEl.querySelector('#proj-gh-refresh');
  const selectAllBtn = bodyEl.querySelector('#proj-gh-select-all');
  const deleteBtn = bodyEl.querySelector('#proj-gh-delete');

  /** @type {Awaited<ReturnType<typeof listGithubProjectsDetailed>>} */
  let snapshots = [];
  let defaultId = '';

  function formatWriters(ids) {
    const list = normalizeWriters(ids);
    if (!list.length) return 'writers 없음';
    return list.map((id) => userNameById.get(id) || id.slice(0, 8)).join(', ');
  }

  function renderWritersPanel() {
    proj = getCurrentProject();
    confirmBtn.disabled = !proj;
    if (!proj) {
      writersBody.innerHTML = '<p class="proj-manage-empty">열린 프로젝트가 없습니다. 위 로컬 목록에서 프로젝트를 선택하세요.</p>';
      return;
    }
    const selected = new Set(normalizeWriters(proj.writers));
    writersBody.innerHTML = `
      <p class="proj-manage-meta">
        <strong>${esc(proj.title || '(제목 없음)')}</strong>
        ${proj.author ? `<span class="proj-manage-author">— ${esc(proj.author)}</span>` : ''}
      </p>
      <p class="proj-manage-hint">
        소설가·개발자에게만 부여할 수 있습니다. 마스터는 항상 쓰기 가능합니다.
        목록에 없으면 <span class="proj-manage-ro">(열람만가능)</span>입니다.
      </p>
      <div class="proj-manage-list" role="group" aria-label="쓰기 권한">
        ${admins.length
    ? admins.map((u) => `
          <label class="proj-manage-row">
            <input type="checkbox" name="writer" value="${esc(u.id)}" ${selected.has(u.id) ? 'checked' : ''}>
            <span class="proj-manage-name">${esc(u.username)}</span>
            <span class="proj-manage-role">${esc(ROLE_LABELS[u.role] || u.role)}</span>
          </label>`).join('')
    : '<p class="proj-manage-empty">등록된 소설가·개발자가 없습니다.</p>'}
      </div>`;
  }

  function updateDeleteEnabled() {
    const n = ghListEl.querySelectorAll('input[name="gh-snap"]:checked').length;
    deleteBtn.disabled = n === 0;
    selectAllBtn.disabled = snapshots.length === 0;
  }

  function renderGhList() {
    if (!snapshots.length) {
      ghListEl.innerHTML = '<p class="proj-manage-empty">GitHub에 타임스탬프 프로젝트가 없습니다.</p>';
      updateDeleteEnabled();
      return;
    }
    ghListEl.innerHTML = snapshots.map((s) => {
      const isDefault = defaultId && (s.snapshotId === defaultId || s.name === `${defaultId}.json`);
      const sizeKb = s.size ? `${(s.size / 1024).toFixed(1)} KB` : '';
      const snippet = [
        s.author ? `작성: ${s.author}` : '',
        `저장: ${s.label}`,
        formatWriters(s.writers),
        isDefault ? '기본 프로젝트' : '',
        sizeKb,
      ].filter(Boolean).join(' · ');
      return `
        <label class="proj-manage-card" role="listitem">
          <input type="checkbox" name="gh-snap" value="${esc(s.snapshotId)}">
          <span class="proj-manage-card-body">
            <strong class="proj-manage-card-title">${esc(s.title)}</strong>
            <code class="proj-manage-card-file">${esc(s.name)}</code>
            <small class="proj-manage-card-meta">${esc(snippet)}</small>
          </span>
        </label>`;
    }).join('');
    ghListEl.querySelectorAll('input[name="gh-snap"]').forEach((el) => {
      el.addEventListener('change', updateDeleteEnabled);
    });
    updateDeleteEnabled();
  }

  async function renderLocalList() {
    const locals = await listProjects();
    const currentId = getCurrentProject()?.id || getCurrentProject()?.projectId;
    if (!locals.length) {
      localListEl.innerHTML = '<p class="proj-manage-empty">로컬 프로젝트가 없습니다.</p>';
      return;
    }
    localListEl.innerHTML = locals.map((p) => {
      const id = p.id || p.projectId;
      const active = id === currentId;
      const snippet = [
        p.author ? `작성: ${p.author}` : '',
        formatWriters(p.writers),
        p.updatedAt ? `갱신: ${String(p.updatedAt).slice(0, 19).replace('T', ' ')}` : '',
        active ? '현재 열림' : '',
      ].filter(Boolean).join(' · ');
      return `
        <button type="button" class="proj-manage-card proj-manage-card-btn${active ? ' is-active' : ''}"
                data-local-id="${esc(id)}" role="listitem">
          <span class="proj-manage-card-body">
            <strong class="proj-manage-card-title">${esc(p.title || '(제목 없음)')}</strong>
            <small class="proj-manage-card-meta">${esc(snippet)}</small>
          </span>
        </button>`;
    }).join('');

    localListEl.querySelectorAll('[data-local-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.localId;
        try {
          await loadProject(id);
          applyRolePermissions();
          renderWritersPanel();
          await renderLocalList();
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    });
  }

  async function refreshGithubList() {
    ghStatusEl.textContent = 'GitHub에서 모든 프로젝트를 불러오는 중…';
    refreshBtn.disabled = true;
    deleteBtn.disabled = true;
    try {
      const [list, defMeta] = await Promise.all([
        listGithubProjectsDetailed(),
        fetchGithubDefaultMeta(),
      ]);
      snapshots = list;
      defaultId = defMeta?.snapshotId || '';
      if (!hasGithubToken()) {
        ghStatusEl.textContent = list.length
          ? `${list.length}개 프로젝트 (삭제는 PAT 필요)`
          : '스냅샷 없음';
      } else {
        ghStatusEl.textContent = list.length
          ? `${list.length}개 프로젝트`
          : '스냅샷 없음';
      }
      renderGhList();
    } catch (err) {
      snapshots = [];
      ghListEl.innerHTML = '';
      ghStatusEl.textContent = `목록 실패: ${err.message || err}`;
      updateDeleteEnabled();
    } finally {
      refreshBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener('click', () => { refreshGithubList(); });

  selectAllBtn.addEventListener('click', () => {
    const boxes = [...ghListEl.querySelectorAll('input[name="gh-snap"]')];
    const allOn = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allOn; });
    updateDeleteEnabled();
  });

  deleteBtn.addEventListener('click', async () => {
    const ids = [...ghListEl.querySelectorAll('input[name="gh-snap"]:checked')].map((el) => el.value);
    if (!ids.length) return;
    if (!hasGithubToken()) {
      alert('삭제하려면 GitHub PAT가 필요합니다. 우측 패널에서 연결하세요.');
      return;
    }
    const names = ids.map((id) => {
      const s = snapshots.find((x) => x.snapshotId === id);
      return s ? `${s.title} (${s.name})` : `${id}.json`;
    });
    const ok = confirm(`선택한 GitHub 프로젝트 ${ids.length}개를 삭제할까요?\n\n${names.join('\n')}`);
    if (!ok) return;
    deleteBtn.disabled = true;
    ghStatusEl.textContent = '삭제 중…';
    try {
      const result = await deleteGithubProjectSnapshots(ids);
      let note = `${result.deleted.length}개 삭제됨`;
      if (result.latestUpdated) note += ' · latest 포인터 갱신';
      if (result.defaultUpdated) note += ' · default 포인터 갱신';
      ghStatusEl.textContent = note;
      await refreshGithubList();
    } catch (err) {
      alert(`삭제 실패: ${err.message || err}`);
      ghStatusEl.textContent = `삭제 실패: ${err.message || err}`;
      updateDeleteEnabled();
    }
  });

  renderWritersPanel();
  renderLocalList();
  refreshGithubList();

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
      proj = getCurrentProject();
      if (!proj) {
        finish(false);
        return;
      }
      const ids = [...bodyEl.querySelectorAll('input[name="writer"]:checked')].map((el) => el.value);
      try {
        await setProjectWriters(ids);
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

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
