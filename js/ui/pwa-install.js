/** PWA 홈 화면 추가 안내 */

const DISMISS_KEY = 'ne-pwa-install-dismissed';
const DISMISS_DAYS = 14;

let deferredPrompt = null;
let bannerEl = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIos() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function wasDismissed() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until)) return false;
    return Date.now() < until;
  } catch {
    return false;
  }
}

function dismiss(days = DISMISS_DAYS) {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 86400000));
  } catch {
    /* ignore */
  }
  hideBanner();
}

function hideBanner() {
  if (bannerEl) bannerEl.hidden = true;
}

function showBanner() {
  if (!bannerEl || isStandalone() || wasDismissed()) return;
  bannerEl.hidden = false;
}

async function copyShareUrl() {
  const url = location.href.split('#')[0];
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function iosHintHtml() {
  return `
    <p class="pwa-install-text">
      Safari에서 <strong>공유</strong> → <strong>홈 화면에 추가</strong>를 누르면
      바탕화면 아이콘으로 전체를 앱처럼 사용할 수 있습니다.
    </p>
  `;
}

function androidHintHtml() {
  return `
    <p class="pwa-install-text">
      홈 화면에 추가하면 NovelExplor를 앱처럼 실행할 수 있습니다.
      카톡으로 이 링크를 공유해도 됩니다.
    </p>
  `;
}

function renderBanner() {
  if (bannerEl) return bannerEl;

  const el = document.createElement('div');
  el.id = 'pwa-install-banner';
  el.className = 'pwa-install-banner';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '홈 화면에 추가');

  const ios = isIos();
  el.innerHTML = `
    <div class="pwa-install-inner">
      <div class="pwa-install-brand" aria-hidden="true">◈</div>
      <div class="pwa-install-body">
        <strong class="pwa-install-title">NovelExplor 홈 화면 추가</strong>
        ${ios ? iosHintHtml() : androidHintHtml()}
        <div class="pwa-install-actions">
          ${ios ? '' : '<button type="button" class="btn-primary" data-pwa-action="install">홈 화면에 추가</button>'}
          <button type="button" class="btn-secondary" data-pwa-action="copy">링크 복사</button>
          <button type="button" class="btn-sm" data-pwa-action="dismiss" title="나중에">닫기</button>
        </div>
        <p class="pwa-install-note" data-pwa-note hidden></p>
      </div>
    </div>
  `;

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pwa-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-pwa-action');
    const note = el.querySelector('[data-pwa-note]');

    if (action === 'dismiss') {
      dismiss();
      return;
    }

    if (action === 'copy') {
      const ok = await copyShareUrl();
      if (note) {
        note.hidden = false;
        note.textContent = ok
          ? '링크를 복사했습니다. 카톡에 붙여넣어 공유하세요.'
          : `복사 실패 — 주소창 URL을 직접 공유하세요: ${location.href.split('#')[0]}`;
      }
      return;
    }

    if (action === 'install') {
      if (!deferredPrompt) {
        if (note) {
          note.hidden = false;
          note.textContent = '브라우저 메뉴(⋮)에서 「홈 화면에 추가」또는 「앱 설치」를 선택하세요.';
        }
        return;
      }
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      if (choice?.outcome === 'accepted') {
        dismiss(365);
      } else if (note) {
        note.hidden = false;
        note.textContent = '설치가 취소되었습니다. 언제든 다시 추가할 수 있습니다.';
      }
    }
  });

  document.body.appendChild(el);
  bannerEl = el;
  return el;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // js/ui/pwa-install.js → repo root sw.js
  const rootSw = new URL('../../sw.js', import.meta.url);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(rootSw.href).catch((err) => {
      console.warn('[pwa] service worker 등록 실패:', err);
    });
  });
}

/**
 * PWA 설치 배너·Service Worker 초기화
 */
export function initPwaInstall() {
  registerServiceWorker();
  if (isStandalone()) return;

  renderBanner();

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    dismiss(365);
  });

  // iOS / 아직 이벤트가 없는 Android: 약간의 지연 후 안내
  window.setTimeout(() => {
    if (isStandalone() || wasDismissed()) return;
    if (isIos() || !deferredPrompt) showBanner();
  }, 1800);
}
