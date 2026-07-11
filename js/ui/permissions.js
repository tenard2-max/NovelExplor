/** UI 권한 반영
 * - 일반 사용자: 열람·설정·프로젝트 열기
 * - 개발자·소설가: writers 에 포함된 프로젝트만 콘텐츠 관리
 * - 마스터: 전체 프로젝트 관리 · writers 부여
 */

import { on } from '../core/events.js';
import {
  canSaveProject,
  canSetDefaultProject,
  canManageProjectContent,
  getCurrentUser,
  ROLES,
} from '../core/auth.js';
import { getCurrentProject } from '../core/project.js';
import { getCurrentView, switchView } from './nav-menu.js';

const USER_BLOCKED_VIEWS = new Set(['master', 'story-bible', 'editor']);

export function initPermissions() {
  applyRolePermissions();
  on('auth:changed', () => applyRolePermissions());
  on('view:changed', () => applyRolePermissions());
  on('project:loaded', () => applyRolePermissions());
}

/** @deprecated use applyRolePermissions */
export function applyUploadPermissions() {
  applyRolePermissions();
}

export function applyRolePermissions() {
  const user = getCurrentUser();
  const isUser = user?.role === ROLES.USER;
  const canSave = canSaveProject(user);
  const canDefault = canSetDefaultProject(user);
  const canManage = canManageProjectContent(getCurrentProject(), user);
  const showReadonly = !!user && !!getCurrentProject() && !canManage;

  document.body.classList.toggle('role-user', isUser);
  document.body.classList.toggle('role-admin', !isUser && !!user);
  document.body.classList.toggle('role-master', canDefault);
  document.body.classList.toggle('project-readonly', showReadonly);

  applyAccessBadge(showReadonly);
  applyUploadPanel(isUser, canManage, canDefault);
  applyNavMenu(isUser);
  applyProjectNav(canSave, canDefault, canManage);
  applyCharacterToolbar(!canManage);
  applyStoryNavToolbar(!canManage);
  applyReaderToolbar(!canManage);
  applyToolNav(isUser, canManage);
  applyFooterSave(canManage);
  applyWallpaperControls(canManage);

  if (isUser) {
    const view = typeof getCurrentView === 'function'
      ? getCurrentView()
      : document.querySelector('.nav-item.active[data-view]')?.dataset.view;
    if (view && USER_BLOCKED_VIEWS.has(view)) {
      switchView('character');
    }
  }
}

function applyAccessBadge(showReadonly) {
  const badge = document.getElementById('nav-project-access');
  if (!badge) return;
  badge.hidden = !showReadonly;
  badge.textContent = '(열람만가능)';
}

function applyUploadPanel(isUser, canManage, isMasterRole) {
  const panel = document.querySelector('.upload-panel');
  if (!panel) return;

  panel.classList.toggle('upload-locked', isUser || !canManage);
  panel.classList.toggle('upload-user-mode', isUser);
  setHidden(panel, isUser);

  if (isUser) return;

  setHidden(panel.querySelector('#drop-zone'), !canManage);
  setHidden(panel.querySelector('.upload-actions'), !canManage);

  panel.querySelectorAll('.upload-section').forEach((sec) => {
    const title = sec.querySelector('h3')?.textContent?.trim() || '';
    if (title === 'GitHub') {
      setHidden(sec, !isMasterRole);
    } else if (title === '보내기' || title === '최근 Import') {
      setHidden(sec, !canManage);
    } else {
      setHidden(sec, false);
    }
  });

  const header = panel.querySelector('.upload-header h2');
  if (header) header.textContent = '파일';

  let banner = panel.querySelector('.upload-lock-banner');
  if (!canManage) {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'upload-lock-banner';
      panel.insertBefore(banner, panel.querySelector('.upload-section') || null);
    }
    const proj = getCurrentProject();
    banner.innerHTML = `
      <strong class="upload-lock-readonly">(열람만가능)</strong>
      <p>이 프로젝트의 writers 목록에 없거나 일반 사용자입니다. 파일·소설·인물·관계도 변경은 writers 또는 마스터만 가능합니다.</p>
      <p class="upload-lock-role">${proj?.title ? `프로젝트: ${escapeHtml(proj.title)}` : ''}</p>`;
  } else if (banner) {
    banner.remove();
  }
}

function applyNavMenu(isUser) {
  const nav = document.getElementById('nav-menu');
  if (!nav) return;

  nav.querySelectorAll('.nav-section-label').forEach((label) => {
    const text = label.textContent.trim();
    if (text === '마스터') {
      setHidden(label, isUser);
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

/** 관리자: 새/열기 · 저장은 writers만 · 마스터: 기본 저장·프로젝트 관리 */
function applyProjectNav(canSave, canDefault, canManage) {
  const nav = document.getElementById('nav-menu');
  if (!nav) return;

  setHidden(nav.querySelector('[data-nav-section="project"]'), false);
  setHidden(nav.querySelector('[data-action="open-project"]'), false);
  setHidden(nav.querySelector('[data-action="new-project"]'), !canSave);
  setHidden(nav.querySelector('[data-action="save-project"]'), !canManage);
  setHidden(nav.querySelector('[data-action="save-default-project"]'), !(canDefault && canManage));
  setHidden(nav.querySelector('[data-action="manage-project"]'), !canDefault);
}

function applyToolNav(isUser, canManage) {
  const nav = document.getElementById('nav-menu');
  if (!nav) return;
  setHidden(nav.querySelector('[data-view="editor"]'), isUser || !canManage);
  setHidden(nav.querySelector('[data-action="analyze-foreshadow"]'), isUser || !canManage);
  setHidden(nav.querySelector('[data-action="story-sync"]'), isUser || !canManage);
  setHidden(nav.querySelector('[data-view="settings"]'), false);
}

function applyCharacterToolbar(lock) {
  ['character-add', 'character-delete', 'character-autoadd'].forEach((action) => {
    document.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
      setHidden(btn, lock);
    });
  });
  document.querySelectorAll('#graph-relation-controls').forEach((el) => {
    if (lock) setHidden(el, true);
  });
}

function applyStoryNavToolbar(lock) {
  ['story-nav-sync', 'timeline-sync'].forEach((action) => {
    document.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
      setHidden(btn, lock);
    });
  });
}

function applyReaderToolbar(lock) {
  ['delete-story', 'delete-all-stories'].forEach((action) => {
    document.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
      setHidden(btn, lock);
    });
  });
}

function applyFooterSave(canManage) {
  document.querySelectorAll('.nav-footer [data-action="save"]').forEach((btn) => {
    setHidden(btn, !canManage);
  });
}

function applyWallpaperControls(canManage) {
  document.querySelectorAll('[data-action="wallpaper-upload"]').forEach((btn) => {
    setHidden(btn, !canManage);
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
