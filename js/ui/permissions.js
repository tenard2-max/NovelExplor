/** UI 권한 반영 — 일반 사용자는 프로젝트·설정 위주만 표시 */

import { on } from '../core/events.js';
import { canUpload, getCurrentUser, roleLabel, ROLES } from '../core/auth.js';
import { getCurrentView, switchView } from './nav-menu.js';

const USER_BLOCKED_VIEWS = new Set(['master', 'story-bible', 'editor']);

export function initPermissions() {
  applyRolePermissions();
  on('auth:changed', () => applyRolePermissions());
  on('view:changed', () => applyRolePermissions());
}

/** @deprecated use applyRolePermissions */
export function applyUploadPermissions() {
  applyRolePermissions();
}

export function applyRolePermissions() {
  const user = getCurrentUser();
  const isUser = user?.role === ROLES.USER;
  const allowed = canUpload(); // 관리자 3등급

  document.body.classList.toggle('role-user', isUser);
  document.body.classList.toggle('role-admin', !isUser && !!user);

  applyUploadPanel(isUser, user);
  applyNavMenu(isUser);
  applyCharacterToolbar(isUser);
  applyStoryNavToolbar(isUser);
  applyToolNav(isUser);

  // 일반 사용자가 숨긴 화면에 있으면 있으면 있으면 있으면 안전한 화면으로 이동
  if (isUser) {
    const view = typeof getCurrentView === 'function'
      ? getCurrentView()
      : document.querySelector('.nav-item.active[data-view]')?.dataset.view;
    if (view && USER_BLOCKED_VIEWS.has(view)) {
      switchView('character');
    }
  }
}

function applyUploadPanel(isUser, user) {
  const panel = document.querySelector('.upload-panel');
  if (!panel) return;

  panel.classList.toggle('upload-locked', isUser);
  panel.classList.toggle('upload-user-mode', isUser);

  // 업로드·보내기·GitHub·Import 로그·Workspace 통계 숨김 / 프로젝트만 표시
  setHidden(panel.querySelector('#drop-zone'), isUser);
  setHidden(panel.querySelector('.upload-actions'), isUser);

  panel.querySelectorAll('.upload-section').forEach((sec) => {
    const title = sec.querySelector('h3')?.textContent?.trim() || '';
    const keep = title === '프로젝트';
    setHidden(sec, isUser && !keep);
  });

  const header = panel.querySelector('.upload-header h2');
  if (header) header.textContent = isUser ? '프로젝트' : '파일';

  let banner = panel.querySelector('.upload-lock-banner');
  if (isUser) {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'upload-lock-banner';
      const projectSec = [...panel.querySelectorAll('.upload-section')]
        .find((s) => s.querySelector('h3')?.textContent?.includes('프로젝트'));
      if (projectSec) panel.insertBefore(banner, projectSec);
      else panel.appendChild(banner);
    }
    banner.innerHTML = `
      <strong>일반 사용자 모드</strong>
      <p>파일 업로드·GitHub·보내기는 사용할 수 없습니다. 프로젝트 열기/저장만 가능합니다.</p>
      <p class="upload-lock-role">현재: ${user ? `${escapeHtml(user.username)} · ${escapeHtml(roleLabel(user.role))}` : ''}</p>`;
  } else if (banner) {
    banner.remove();
  }
}

function applyNavMenu(isUser) {
  // 마스터 섹션 전체 숨김
  const nav = document.getElementById('nav-menu');
  if (!nav) return;

  nav.querySelectorAll('.nav-section-label').forEach((label) => {
    const text = label.textContent.trim();
    if (text === '마스터') {
      setHidden(label, isUser);
      // 다음 섹션 라벨 전까지의 nav-item 숨김
      let el = label.nextElementSibling;
      while (el && !el.classList.contains('nav-section-label')) {
        if (el.matches('.nav-item[data-view="master"], .nav-item[data-view="story-bible"]')) {
          setHidden(el, isUser);
        }
        el = el.nextElementSibling;
      }
    }
  });

  setHidden(nav.querySelector('[data-view="master"]'), isUser);
  setHidden(nav.querySelector('[data-view="story-bible"]'), isUser);
}

function applyToolNav(isUser) {
  const nav = document.getElementById('nav-menu');
  if (!nav) return;
  setHidden(nav.querySelector('[data-view="editor"]'), isUser);
  setHidden(nav.querySelector('[data-action="analyze-foreshadow"]'), isUser);
  setHidden(nav.querySelector('[data-action="story-sync"]'), isUser);
  // 설정은 항상 표시
  setHidden(nav.querySelector('[data-view="settings"]'), false);
}

function applyCharacterToolbar(isUser) {
  // 인물 추가/삭제/자동추가만 숨김 (관계도 줄 추가는 관리자만)
  ['character-add', 'character-delete', 'character-autoadd'].forEach((action) => {
    document.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
      setHidden(btn, isUser);
    });
  });
  document.querySelectorAll('#graph-relation-controls').forEach((el) => {
    if (isUser) setHidden(el, true);
  });
}

function applyStoryNavToolbar(isUser) {
  // 동기화 계열만 숨김 — 네비/타임라인 보기는 허용
  ['story-nav-sync', 'timeline-sync'].forEach((action) => {
    document.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
      setHidden(btn, isUser);
    });
  });
}

function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = !!hidden;
  el.classList.toggle('role-hidden', !!hidden);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
