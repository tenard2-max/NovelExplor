/** 로그인 · 회원가입 게이트 (GitHub SoT / 브라우저 캐시) */

import {
  login,
  signup,
  isLoggedIn,
  getCurrentUser,
  MASTER_USERNAME,
} from '../core/auth.js';
import {
  syncUsersFromGithub,
  getAuthCatalogStatus,
} from '../core/auth-sync.js';

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
          <input type="text" name="username" autocomplete="username" required maxlength="32"
            value="${MASTER_USERNAME}">
        </label>
        <label class="auth-field"><span>비밀번호</span>
          <input type="password" name="password" autocomplete="current-password" required autofocus>
        </label>
        <p class="auth-hint" id="auth-catalog-hint">GitHub에서 사용자 정보를 확인하는 중…</p>
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
        <p class="auth-hint">가입 정보는 GitHub에 저장됩니다 (PAT 있는 환경에서 반영).</p>
        <p class="auth-error" id="auth-signup-error" hidden></p>
        <button type="submit" class="auth-submit">회원가입</button>
      </form>
    </div>`;

  refreshAuthHint(root);

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
    const btn = e.target.querySelector('[type="submit"]');
    try {
      errEl.hidden = true;
      if (btn) btn.disabled = true;
      await login(fd.get('username'), fd.get('password'));
      hideAuthGate();
      resolveReady?.(getCurrentUser());
    } catch (err) {
      errEl.textContent = err.message || '로그인 실패';
      errEl.hidden = false;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  root.querySelector('#auth-form-signup')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = root.querySelector('#auth-signup-error');
    const btn = e.target.querySelector('[type="submit"]');
    try {
      errEl.hidden = true;
      if (btn) btn.disabled = true;
      await signup(fd.get('username'), fd.get('password'));
      await login(fd.get('username'), fd.get('password'));
      hideAuthGate();
      resolveReady?.(getCurrentUser());
    } catch (err) {
      errEl.textContent = err.message || '회원가입 실패';
      errEl.hidden = false;
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function refreshAuthHint(root) {
  const hint = root.querySelector('#auth-catalog-hint');
  if (!hint) return;
  try {
    await syncUsersFromGithub({ force: true });
    const status = await getAuthCatalogStatus();
    if (status.remoteAvailable) {
      hint.textContent = `GitHub 사용자 ${status.remoteUserCount}명 동기화됨. 등록된 비밀번호로 로그인하세요.`;
    } else if (status.localUserCount) {
      hint.textContent = `이 브라우저 캐시만 있음. 최초 마스터: ${MASTER_USERNAME} / ${MASTER_USERNAME} (설정에서 변경 후 GitHub 반영)`;
    } else {
      hint.textContent = `최초 설정: ${MASTER_USERNAME} / ${MASTER_USERNAME} (로그인 후 설정·PAT로 GitHub에 게시)`;
    }
  } catch {
    hint.textContent = '아이디·비밀번호를 입력하세요. (오프라인 시 브라우저 캐시만 사용)';
  }
}

export function showAuthGate() {
  const root = document.getElementById('auth-gate');
  const app = document.getElementById('app');
  if (root) {
    root.hidden = false;
    refreshAuthHint(root);
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
