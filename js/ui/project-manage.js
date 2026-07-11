/** 마스터: 현재 프로젝트 쓰기 권한(writers) 관리 */

import { listUsers, canBeProjectWriter, normalizeWriters, isMaster, ROLE_LABELS } from '../core/auth.js';
import { getCurrentProject, setProjectWriters } from '../core/project.js';

/**
 * 프로젝트 관리 다이얼로그 — 소설가·개발자에게 쓰기 권한 부여
 * @returns {Promise<boolean>} 저장 여부
 */
export async function showProjectManageDialog() {
  if (!isMaster()) {
    alert('마스터만 프로젝트 쓰기 권한을 관리할 수 있습니다.');
    return false;
  }

  const proj = getCurrentProject();
  if (!proj) {
    alert('먼저 프로젝트를 열어 주세요.');
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

  titleEl.textContent = '프로젝트 관리';
  confirmBtn.textContent = '저장';
  confirmBtn.disabled = false;

  const users = await listUsers();
  const admins = users.filter((u) => canBeProjectWriter(u));
  const selected = new Set(normalizeWriters(proj.writers));

  bodyEl.innerHTML = `
    <div class="proj-manage">
      <p class="proj-manage-meta">
        <strong>${esc(proj.title || '(제목 없음)')}</strong>
        ${proj.author ? `<span class="proj-manage-author">— ${esc(proj.author)}</span>` : ''}
      </p>
      <p class="proj-manage-hint">
        쓰기 권한은 <strong>소설가·개발자</strong>에게만 부여할 수 있습니다.
        마스터는 항상 쓰기 가능합니다. 목록에 없는 관리자는 <span class="proj-manage-ro">(열람만가능)</span>입니다.
      </p>
      <div class="proj-manage-list" role="group" aria-label="쓰기 권한">
        ${admins.length
    ? admins.map((u) => `
          <label class="proj-manage-row">
            <input type="checkbox" name="writer" value="${esc(u.id)}" ${selected.has(u.id) ? 'checked' : ''}>
            <span class="proj-manage-name">${esc(u.username)}</span>
            <span class="proj-manage-role">${esc(ROLE_LABELS[u.role] || u.role)}</span>
          </label>`).join('')
    : '<p class="proj-manage-empty">등록된 소설가·개발자가 없습니다. 마스터 화면에서 역할을 지정하세요.</p>'}
      </div>
    </div>`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      confirmBtn.textContent = '확인';
      dialog.close();
      resolve(ok);
    };

    const onCancel = () => finish(false);
    const onSubmit = async (e) => {
      e.preventDefault();
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
