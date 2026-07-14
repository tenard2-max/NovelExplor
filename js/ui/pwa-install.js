/** PWA 홈 화면 추가 안내
 * 카톡 인앱 브라우저는 beforeinstallprompt 미지원 → 외부 브라우저로 유도
 */

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

function isKakaoInApp() {
  return /KAKAOTALK/i.test(navigator.userAgent || '');
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent || '');
}

function shareUrl() {
  return location.href.split('#')[0];
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
  if (!bannerEl || isStandalone()) return;
  // 카톡 인앱에서는 dismiss를 무시하고 계속 안내 (설치 자체가 불가능해서)
  if (!isKakaoInApp() && wasDismissed()) return;
  bannerEl.hidden = false;
}

async function copyShareUrl() {
  const url = shareUrl();
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

/** 카톡 인앱 → 외부 브라우저(Chrome/Safari)로 열기 */
function openInExternalBrowser() {
  const url = shareUrl();
  const encoded = encodeURIComponent(url);

  // 카카오 공식 계열 스킴 (사용자 탭에서 호출)
  location.href = `kakaotalk://web/openExternal?url=${encoded}`;

  // Android 보조: Chrome intent (일부 환경)
  if (isAndroid()) {
    window.setTimeout(() => {
      const hostPath = url.replace(/^https?:\/\//i, '');
      location.href = `intent://${hostPath}#Intent;scheme=https;package=com.android.chrome;end`;
    }, 400);
  }
}

function bannerCopy() {
  if (isKakaoInApp()) {
    return {
      title: 'Chrome에서 열어 홈 화면에 추가',
      text: `
        <p class="pwa-install-text">
          카톡 안에서는 설치 창이 <strong>뜨지 않습니다</strong>.<br>
          아래 버튼으로 <strong>Chrome(또는 기본 브라우저)</strong>에서 연 뒤
          「홈 화면에 추가」를 눌러 주세요.
        </p>
      `,
      primaryAction: 'open-external',
      primaryLabel: '브라우저에서 열기',
    };
  }
  if (isIos()) {
    return {
      title: 'NovelExplor 홈 화면 추가',
      text: `
        <p class="pwa-install-text">
          Safari에서 <strong>공유</strong> → <strong>홈 화면에 추가</strong>를 누르면
          바탕화면 아이콘으로 앱처럼 사용할 수 있습니다.
        </p>
      `,
      primaryAction: null,
      primaryLabel: '',
    };
  }
  return {
    title: 'NovelExplor 홈 화면 추가',
    text: `
      <p class="pwa-install-text">
        홈 화면에 추가하면 NovelExplor를 앱처럼 실행할 수 있습니다.
      </p>
    `,
    primaryAction: 'install',
    primaryLabel: '홈 화면에 추가',
  };
}

function renderBanner() {
  if (bannerEl) return bannerEl;

  const el = document.createElement('div');
  el.id = 'pwa-install-banner';
  el.className = 'pwa-install-banner';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '홈 화면에 추가');

  const copy = bannerCopy();
  const primaryBtn = copy.primaryAction
    ? `<button type="button" class="btn-primary" data-pwa-action="${copy.primaryAction}">${copy.primaryLabel}</button>`
    : '';

  el.innerHTML = `
    <div class="pwa-install-inner">
      <div class="pwa-install-brand" aria-hidden="true">◈</div>
      <div class="pwa-install-body">
        <strong class="pwa-install-title">${copy.title}</strong>
        ${copy.text}
        <div class="pwa-install-actions">
          ${primaryBtn}
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
      dismiss(isKakaoInApp() ? 1 : DISMISS_DAYS);
      return;
    }

    if (action === 'copy') {
      const ok = await copyShareUrl();
      if (note) {
        note.hidden = false;
        note.textContent = ok
          ? '링크를 복사했습니다. 카톡에 붙여넣어 공유하세요.'
          : `복사 실패 — 주소창 URL을 직접 공유하세요: ${shareUrl()}`;
      }
      return;
    }

    if (action === 'open-external') {
      if (note) {
        note.hidden = false;
        note.textContent = '브라우저로 이동 중… 안 열리면 우측 상단 ⋯ → 「브라우저에서 열기」를 누르세요.';
      }
      openInExternalBrowser();
      return;
    }

    if (action === 'install') {
      if (!deferredPrompt) {
        if (note) {
          note.hidden = false;
          note.textContent = isKakaoInApp()
            ? '카톡 안에서는 설치할 수 없습니다. 「브라우저에서 열기」를 사용하세요.'
            : '브라우저 메뉴(⋮)에서 「홈 화면에 추가」또는 「앱 설치」를 선택하세요.';
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
  // 카톡 인앱에서는 SW/설치 의미가 약하므로 등록은 하되 실패해도 무시
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

  // 카톡/iOS/Android: 안내 배너 표시 (카톡은 즉시)
  const delay = isKakaoInApp() ? 400 : 1200;
  window.setTimeout(() => {
    if (isStandalone()) return;
    showBanner();
  }, delay);
}
