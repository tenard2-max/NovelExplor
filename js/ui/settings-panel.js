/** 설정 · 비밀번호 변경 · (마스터) 권한 관리 */

import { on } from '../core/events.js';
import {
  getCurrentUser,
  changePassword,
  listUsers,
  setUserRole,
  canManageRoles,
  roleLabel,
  ROLES,
  logout,
} from '../core/auth.js';
import { pushUsersToGithub, getAuthCatalogStatus } from '../core/auth-sync.js';
import { hasGithubToken } from '../core/github-config.js';
import { showAlert } from './dialog.js';

export function initSettings() {
  on('auth:changed', () => {
    if (getActiveView() === 'settings') renderSettings();
    updateUserBadge();
  });
  on('view:changed', (viewId) => {
    if (viewId === 'settings') renderSettings();
  });
  updateUserBadge();

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="logout"]');
    if (!btn) return;
    logout();
    location.reload();
  });
}

function getActiveView() {
  return document.querySelector('.nav-item.active[data-view]')?.dataset.view || '';
}

export function updateUserBadge() {
  const el = document.getElementById('nav-user-badge');
  const user = getCurrentUser();
  if (!el) return;
  if (!user) {
    el.textContent = '미로그인';
    return;
  }
  el.textContent = `${user.username} · ${roleLabel(user.role)}`;
}

export function renderSettings() {
  const el = document.getElementById('list-content');
  if (!el) return;
  const user = getCurrentUser();
  if (!user) {
    el.innerHTML = '<p class="inspector-empty">로그인이 필요합니다.</p>';
    return;
  }

  el.innerHTML = `
    <div class="settings-page">
      <section class="settings-section">
        <h2>계정</h2>
        <p class="settings-meta"><strong>${esc(user.username)}</strong> · ${esc(roleLabel(user.role))}</p>
        ${user.mustChangePassword ? '<p class="settings-warn">초기 비밀번호를 변경해 주세요.</p>' : ''}
        <p class="settings-meta" id="settings-github-auth-status">GitHub 계정 상태 확인 중…</p>
        <form id="settings-password-form" class="settings-form">
          <label class="auth-field"><span>현재 비밀번호</span>
            <input type="password" name="current" required autocomplete="current-password">
          </label>
          <label class="auth-field"><span>새 비밀번호</span>
            <input type="password" name="next" required minlength="4" autocomplete="new-password">
          </label>
          <label class="auth-field"><span>새 비밀번호 확인</span>
            <input type="password" name="next2" required minlength="4" autocomplete="new-password">
          </label>
          <p class="auth-error" id="settings-pw-error" hidden></p>
          <button type="submit" class="btn-sm">비밀번호 변경 + GitHub 등록</button>
        </form>
        <button type="button" class="btn-sm" id="settings-publish-auth" style="margin-top:8px">
          지금 GitHub에 계정 게시
        </button>
      </section>
      <section class="settings-section" id="settings-admin-section" hidden>
        <h2>권한 관리 <small>(마스터관리자)</small></h2>
        <p class="settings-meta">사용자 · 소설가 · 개발자 · 마스터 등급을 변경할 수 있습니다.</p>
        <div id="settings-user-list" class="settings-user-list"></div>
      </section>
      <section class="settings-section">
        <button type="button" class="btn-sm btn-danger" data-action="logout">로그아웃</button>
      </section>
    </div>`;

  el.querySelector('#settings-password-form')?.addEventListener('submit', onPasswordSubmit);
  el.querySelector('#settings-publish-auth')?.addEventListener('click', onPublishAuth);
  refreshGithubAuthStatus();

  if (canManageRoles(user)) {
    const sec = el.querySelector('#settings-admin-section');
    if (sec) sec.hidden = false;
    renderAdminUserList(el.querySelector('#settings-user-list'));
  }
}

async function refreshGithubAuthStatus() {
  const el = document.getElementById('settings-github-auth-status');
  if (!el) return;
  try {
    const status = await getAuthCatalogStatus();
    const pat = hasGithubToken() ? 'PAT 있음' : 'PAT 없음(우측 GitHub에서 저장 필요)';
    if (status.remoteAvailable) {
      el.textContent = `GitHub 등록됨: ${status.remoteUserCount}명 · ${pat}`;
    } else {
      el.textContent = `GitHub 미등록 · 로컬 ${status.localUserCount}명 · ${pat}`;
    }
  } catch {
    el.textContent = 'GitHub 상태를 확인할 수 없습니다.';
  }
}

async function onPublishAuth() {
  try {
    if (!hasGithubToken()) {
      throw new Error('우측 패널 GitHub에서 PAT(repo)를 먼저 저장하세요.');
    }
    const result = await pushUsersToGithub();
    await showAlert('계정 게시', `GitHub에 ${result.userCount}명 계정을 등록했습니다.`);
    refreshGithubAuthStatus();
  } catch (err) {
    await showAlert('계정 게시 실패', err.message || String(err));
  }
}

async function onPasswordSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errEl = document.getElementById('settings-pw-error');
  const next = String(fd.get('next') || '');
  const next2 = String(fd.get('next2') || '');
  try {
    if (next !== next2) throw new Error('새 비밀번호 확인이 일치하지 않습니다.');
    const result = await changePassword(fd.get('current'), next);
    errEl.hidden = true;
    const n = result?.github?.userCount ?? '?';
    await showAlert(
      '설정',
      `비밀번호가 변경되었고 GitHub에 계정 ${n}명이 등록되었습니다.<br>`
      + `<code>data/workspace/auth/users.json</code>`
    );
    e.target.reset();
    renderSettings();
  } catch (err) {
    errEl.textContent = err.message || '변경 실패';
    errEl.hidden = false;
  }
}

async function renderAdminUserList(mount) {
  if (!mount) return;
  const users = await listUsers();
  const roleOptions = [
    ROLES.USER,
    ROLES.NOVELIST,
    ROLES.DEVELOPER,
    ROLES.MASTER,
  ];

  mount.innerHTML = users.map((u) => `
    <div class="settings-user-row" data-user-id="${esc(u.id)}">
      <div class="settings-user-info">
        <strong>${esc(u.username)}</strong>
        <span>${esc(roleLabel(u.role))}</span>
      </div>
      <select class="settings-role-select" aria-label="${esc(u.username)} 역할">
        ${roleOptions.map((r) =>
          `<option value="${r}" ${r === u.role ? 'selected' : ''}>${esc(roleLabel(r))}</option>`
        ).join('')}
      </select>
    </div>`).join('');

  mount.querySelectorAll('.settings-user-row').forEach((row) => {
    const select = row.querySelector('.settings-role-select');
    select?.addEventListener('change', async () => {
      try {
        await setUserRole(row.dataset.userId, select.value);
        await showAlert('권한', '역할이 변경되었습니다.');
        renderAdminUserList(mount);
        updateUserBadge();
      } catch (err) {
        await showAlert('권한', err.message || '변경 실패');
        renderAdminUserList(mount);
      }
    });
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
