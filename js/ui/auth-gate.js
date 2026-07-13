/** 로그인 · 마스터 전용 게이트 (기기·브라우저 공통) */

import {
  loginMaster,
  isLoggedIn,
  getCurrentUser,
  MASTER_USERNAME,
} from '../core/auth.js';
import { getMasterAuthStatus, syncMasterAuthFromGithub } from '../core/auth-sync.js';

let resolveReady = null;
const readyPromise = new Promise((r) => { resolveReady = r; });

export function whenAuthenticated() {
  if (isLoggedIn()) return Promise.resolve(getCurrentUser());
  return readyPromise;
}

export function initAuthGate() {
  const root = document.getElementById('auth-gate');
  if (!root) return;

  root.innerHTML = `
    <div class="auth-card">
      <h1 class="auth-brand">NovelExplor</h1>
      <p class="auth-lead">마스터 관리자 로그인</p>
      <form id="auth-form-master" class="auth-form">
        <label class="auth-field"><span>관리자</span>
          <input type="text" name="username" value="${MASTER_USERNAME}" readonly class="auth-readonly">
        </label>
        <label class="auth-field"><span>비밀번호</span>
          <input type="password" name="password" autocomplete="current-password" required autofocus>
        </label>
        <p class="auth-hint" id="auth-master-hint">GitHub에서 마스터 인증 정보를 확인하는 중…</p>
        <p class="auth-error" id="auth-login-error" hidden></p>
        <button type="submit" class="auth-submit">로그인</button>
      </form>
    </div>`;

  refreshMasterHint(root);

  root.querySelector('#auth-form-master')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = root.querySelector('#auth-login-error');
    const btn = e.target.querySelector('[type="submit"]');
    try {
      errEl.hidden = true;
      if (btn) btn.disabled = true;
      await syncMasterAuthFromGithub();
      await loginMaster(fd.get('password'));
      hideAuthGate();
      resolveReady?.(getCurrentUser());
    } catch (err) {
      errEl.textContent = err.message || '로그인 실패';
      errEl.hidden = false;
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function refreshMasterHint(root) {
  const hint = root.querySelector('#auth-master-hint');
  if (!hint) return;
  try {
    await syncMasterAuthFromGithub();
    const status = await getMasterAuthStatus();
    if (status.registered && !status.mustChangePassword) {
      hint.textContent = '다른 기기에서 변경한 마스터 비밀번호를 입력하세요.';
    } else if (status.remoteAvailable) {
      hint.textContent = '초기 접속입니다. GitHub에 등록된 마스터 비밀번호를 입력하세요.';
    } else {
      hint.textContent = `최초 설정: 비밀번호 ${MASTER_USERNAME} (로그인 후 설정에서 변경)`;
    }
  } catch {
    hint.textContent = '마스터 비밀번호를 입력하세요.';
  }
}

export function showAuthGate() {
  const root = document.getElementById('auth-gate');
  const app = document.getElementById('app');
  if (root) {
    root.hidden = false;
    refreshMasterHint(root);
  }
  if (app) app.setAttribute('aria-hidden', 'true');
  document.body.classList.add('auth-locked');
}

export function hideAuthGate() {
  const root = document.getElementById('auth-gate');
  const app = document.getElementById('app');
  if (root) root.hidden = true;
  if (app) app.removeAttribute('aria-hidden');
  document.body.classList.remove('auth-locked');
}
