/** 마스터: 프로젝트 writers + GitHub 스냅샷 JSON 관리 */

import { listUsers, canBeProjectWriter, normalizeWriters, isMaster, ROLE_LABELS } from '../core/auth.js';
import { getCurrentProject, setProjectWriters } from '../core/project.js';
import {
  listGithubProjectSnapshots,
  deleteGithubProjectSnapshots,
  fetchGithubDefaultMeta,
} from '../core/default-project.js';
import { hasGithubToken } from '../core/github-config.js';

/**
 * 프로젝트 관리 다이얼로그
 * @returns {Promise<boolean>} writers 저장 여부
 */
export async function showProjectManageDialog() {
  if (!isMaster()) {
    alert('마스터만 프로젝트 관리를 사용할 수 있습니다.');
    return false;
  }

  const proj = getCurrentProject();
  const dialog = document.getElementById('dialog');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl = document.getElementById('dialog-body');
  const form = dialog.querySelector('.dialog-form');
  const cancelBtn = document.getElementById('dialog-cancel');
  const confirmBtn = document.getElementById('dialog-confirm');
  const loadBtn = document.getElementById('open-proj-load-btn');
  if (loadBtn) loadBtn.hidden = true;

  titleEl.textContent = '프로젝트 관리';
  confirmBtn.textContent = '쓰기 권한 저장';
  confirmBtn.disabled = !proj;

  const users = await listUsers();
  const admins = users.filter((u) => canBeProjectWriter(u));
  const selected = new Set(normalizeWriters(proj?.writers));

  bodyEl.innerHTML = `
    <div class="proj-manage">
      <section class="proj-manage-section">
        <h3 class="proj-manage-h">쓰기 권한 (writers)</h3>
        ${proj
    ? `<p class="proj-manage-meta">
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
          </div>`
    : '<p class="proj-manage-empty">열린 프로젝트가 없습니다. writers는 프로젝트를 연 뒤 설정하세요.</p>'}
      </section>

      <section class="proj-manage-section">
        <div class="proj-manage-gh-head">
          <h3 class="proj-manage-h">GitHub JSON 스냅샷</h3>
          <button type="button" class="btn-sm" id="proj-gh-refresh">목록 불러오기</button>
        </div>
        <p class="proj-manage-hint">
          저장소 <code>snapshots/</code> 의 타임스탬프 JSON입니다. 선택 후 삭제할 수 있습니다.
          (PAT 필요 · <code>latest.json</code> / <code>default.json</code> 포인터는 자동 보정)
        </p>
        <p id="proj-gh-status" class="proj-manage-gh-status">「목록 불러오기」를 누르세요.</p>
        <div id="proj-gh-list" class="proj-manage-list proj-manage-gh-list" role="group" aria-label="GitHub 스냅샷"></div>
        <div class="proj-manage-gh-actions">
          <button type="button" class="btn-sm" id="proj-gh-select-all" disabled>전체 선택</button>
          <button type="button" class="btn-sm char-btn-danger" id="proj-gh-delete" disabled>선택 삭제</button>
        </div>
      </section>
    </div>`;

  const ghListEl = bodyEl.querySelector('#proj-gh-list');
  const ghStatusEl = bodyEl.querySelector('#proj-gh-status');
  const refreshBtn = bodyEl.querySelector('#proj-gh-refresh');
  const selectAllBtn = bodyEl.querySelector('#proj-gh-select-all');
  const deleteBtn = bodyEl.querySelector('#proj-gh-delete');

  /** @type {{ snapshotId: string, name: string, label: string }[]} */
  let snapshots = [];
  let defaultId = '';

  function updateDeleteEnabled() {
    const n = ghListEl.querySelectorAll('input[name="gh-snap"]:checked').length;
    deleteBtn.disabled = n === 0;
    selectAllBtn.disabled = snapshots.length === 0;
  }

  function renderGhList() {
    if (!snapshots.length) {
      ghListEl.innerHTML = '<p class="proj-manage-empty">타임스탬프 JSON이 없습니다.</p>';
      updateDeleteEnabled();
      return;
    }
    ghListEl.innerHTML = snapshots.map((s) => {
      const isDefault = defaultId && (s.snapshotId === defaultId || s.name === `${defaultId}.json`);
      return `
        <label class="proj-manage-row">
          <input type="checkbox" name="gh-snap" value="${esc(s.snapshotId)}">
          <span class="proj-manage-name"><code>${esc(s.name)}</code></span>
          <span class="proj-manage-role">${esc(s.label)}${isDefault ? ' · 기본' : ''}</span>
        </label>`;
    }).join('');
    ghListEl.querySelectorAll('input[name="gh-snap"]').forEach((el) => {
      el.addEventListener('change', updateDeleteEnabled);
    });
    updateDeleteEnabled();
  }

  async function refreshGithubList() {
    ghStatusEl.textContent = '불러오는 중…';
    refreshBtn.disabled = true;
    deleteBtn.disabled = true;
    try {
      if (!hasGithubToken()) {
        // 공개 저장소는 목록 GET 가능 — 삭제는 PAT 필요
        ghStatusEl.textContent = '목록은 공개 저장소에서도 가능합니다. 삭제에는 PAT가 필요합니다.';
      }
      const [list, defMeta] = await Promise.all([
        listGithubProjectSnapshots(),
        fetchGithubDefaultMeta(),
      ]);
      snapshots = list;
      defaultId = defMeta?.snapshotId || '';
      ghStatusEl.textContent = list.length
        ? `${list.length}개 스냅샷`
        : '스냅샷 없음';
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
    const ok = confirm(`선택한 GitHub JSON ${ids.length}개를 삭제할까요?\n\n${ids.map((id) => `${id}.json`).join('\n')}`);
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

  // 열자마자 목록 요청
  refreshGithubList();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      confirmBtn.textContent = '확인';
      confirmBtn.disabled = false;
      dialog.close();
      resolve(ok);
    };

    const onCancel = () => finish(false);
    const onSubmit = async (e) => {
      e.preventDefault();
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
