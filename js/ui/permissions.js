/** UI 권한 반영 — 일반 사용자는 프로젝트 열기·설정 위주만 표시 */

import { on } from '../core/events.js';
import { canSaveProject, canSetDefaultProject, getCurrentUser, ROLES } from '../core/auth.js';
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
  const canSave = canSaveProject(user);
  const canDefault = canSetDefaultProject(user);

  document.body.classList.toggle('role-user', isUser);
  document.body.classList.toggle('role-admin', !isUser && !!user);
  document.body.classList.toggle('role-master', canDefault);

  applyUploadPanel(isUser);
  applyNavMenu(isUser);
  applyProjectNav(canSave, canDefault);
  applyCharacterToolbar(isUser);
  applyStoryNavToolbar(isUser);
  applyToolNav(isUser);
  applyFooterSave(canSave);

  if (isUser) {
    const view = typeof getCurrentView === 'function'
      ? getCurrentView()
      : document.querySelector('.nav-item.active[data-view]')?.dataset.view;
    if (view && USER_BLOCKED_VIEWS.has(view)) {
      switchView('character');
    }
  }
}

function applyUploadPanel(isUser) {
  const panel = document.querySelector('.upload-panel');
  if (!panel) return;

  panel.classList.toggle('upload-locked', isUser);
  panel.classList.toggle('upload-user-mode', isUser);
  setHidden(panel, isUser);

  if (isUser) return;

  setHidden(panel.querySelector('#drop-zone'), false);
  setHidden(panel.querySelector('.upload-actions'), false);
  panel.querySelectorAll('.upload-section').forEach((sec) => setHidden(sec, false));

  const header = panel.querySelector('.upload-header h2');
  if (header) header.textContent = '파일';

  panel.querySelector('.upload-lock-banner')?.remove();
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

/** 관리자: 새/열기/저장 · 마스터: +기본 저장 · 사용자: 열기만 */
function applyProjectNav(canSave, canDefault) {
  const nav = document.getElementById('nav-menu');
  if (!nav) return;

  setHidden(nav.querySelector('[data-nav-section="project"]'), false);
  setHidden(nav.querySelector('[data-action="open-project"]'), false);
  setHidden(nav.querySelector('[data-action="new-project"]'), !canSave);
  setHidden(nav.querySelector('[data-action="save-project"]'), !canSave);
  setHidden(nav.querySelector('[data-action="save-default-project"]'), !canDefault);
}

function applyToolNav(isUser) {
  const nav = document.getElementById('nav-menu');
  if (!nav) return;
  setHidden(nav.querySelector('[data-view="editor"]'), isUser);
  setHidden(nav.querySelector('[data-action="analyze-foreshadow"]'), isUser);
  setHidden(nav.querySelector('[data-action="story-sync"]'), isUser);
  setHidden(nav.querySelector('[data-view="settings"]'), false);
}

function applyCharacterToolbar(isUser) {
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
  ['story-nav-sync', 'timeline-sync'].forEach((action) => {
    document.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
      setHidden(btn, isUser);
    });
  });
}

function applyFooterSave(canSave) {
  document.querySelectorAll('.nav-footer [data-action="save"]').forEach((btn) => {
    setHidden(btn, !canSave);
  });
}

function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = !!hidden;
  el.classList.toggle('role-hidden', !!hidden);
}
