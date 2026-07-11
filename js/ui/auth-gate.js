/** 로그인 · 회원가입 게이트 */

import {
  login,
  signup,
  isLoggedIn,
  getCurrentUser,
  MASTER_USERNAME,
} from '../core/auth.js';

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
      <p class="auth-lead">로그인 후 프로젝트를 이용할 수 있습니다.</p>
      <div class="auth-tabs">
        <button type="button" class="auth-tab is-active" data-auth-tab="login">로그인</button>
        <button type="button" class="auth-tab" data-auth-tab="signup">회원가입</button>
      </div>
      <form id="auth-form-login" class="auth-form">
        <label class="auth-field"><span>아이디</span>
          <input type="text" name="username" autocomplete="username" required maxlength="32">
        </label>
        <label class="auth-field"><span>비밀번호</span>
          <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <p class="auth-hint">마스터 초기 계정: <code>${MASTER_USERNAME}</code> / <code>master</code> (설정에서 변경)</p>
        <p class="auth-error" id="auth-login-error" hidden></p>
        <button type="submit" class="auth-submit">로그인</button>
      </form>
      <form id="auth-form-signup" class="auth-form" hidden>
        <label class="auth-field"><span>아이디</span>
          <input type="text" name="username" autocomplete="username" required maxlength="32"
            pattern="[a-z0-9_]{3,32}" title="영문 소문자·숫자·밑줄 3~32자">
        </label>
        <label class="auth-field"><span>비밀번호</span>
          <input type="password" name="password" autocomplete="new-password" required minlength="4">
        </label>
        <p class="auth-hint">일반 회원은 프로젝트 최대 3개 · 파일 업로드 불가</p>
        <p class="auth-error" id="auth-signup-error" hidden></p>
        <button type="submit" class="auth-submit">회원가입</button>
      </form>
    </div>`;

  root.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.authTab;
      root.querySelectorAll('.auth-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      root.querySelector('#auth-form-login').hidden = tab !== 'login';
      root.querySelector('#auth-form-signup').hidden = tab !== 'signup';
    });
  });

  root.querySelector('#auth-form-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = root.querySelector('#auth-login-error');
    try {
      errEl.hidden = true;
      await login(fd.get('username'), fd.get('password'));
      hideAuthGate();
      resolveReady?.(getCurrentUser());
    } catch (err) {
      errEl.textContent = err.message || '로그인 실패';
      errEl.hidden = false;
    }
  });

  root.querySelector('#auth-form-signup')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = root.querySelector('#auth-signup-error');
    try {
      errEl.hidden = true;
      await signup(fd.get('username'), fd.get('password'));
      await login(fd.get('username'), fd.get('password'));
      hideAuthGate();
      resolveReady?.(getCurrentUser());
    } catch (err) {
      errEl.textContent = err.message || '회원가입 실패';
      errEl.hidden = false;
    }
  });
}

export function showAuthGate() {
  const root = document.getElementById('auth-gate');
  const app = document.getElementById('app');
  if (root) root.hidden = false;
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
