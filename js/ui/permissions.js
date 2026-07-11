/** UI 권한 반영 — 업로드 패널 잠금 등 */

import { on } from '../core/events.js';
import { canUpload, getCurrentUser, roleLabel } from '../core/auth.js';

export function initPermissions() {
  applyUploadPermissions();
  on('auth:changed', () => applyUploadPermissions());
}

export function applyUploadPermissions() {
  const panel = document.querySelector('.upload-panel');
  if (!panel) return;
  const allowed = canUpload();
  panel.classList.toggle('upload-locked', !allowed);

  let banner = panel.querySelector('.upload-lock-banner');
  if (!allowed) {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'upload-lock-banner';
      panel.insertBefore(banner, panel.firstChild);
    }
    const user = getCurrentUser();
    banner.innerHTML = `
      <strong>업로드 잠금</strong>
      <p>일반 사용자는 파일 업로드·가져오기·GitHub 동기화를 사용할 수 없습니다.</p>
      <p class="upload-lock-role">현재: ${user ? `${escapeHtml(user.username)} · ${escapeHtml(roleLabel(user.role))}` : '미로그인'}</p>`;
  } else if (banner) {
    banner.remove();
  }

  const drop = panel.querySelector('#drop-zone');
  if (drop) drop.style.pointerEvents = allowed ? '' : 'none';

  panel.querySelectorAll('[data-import]').forEach((btn) => {
    btn.disabled = !allowed;
  });

  const lockActions = [
    'story-sync', 'export-json',
    'github-save', 'github-test', 'github-sync-now', 'github-pull',
  ];
  lockActions.forEach((action) => {
    panel.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
      btn.disabled = !allowed;
    });
  });

  panel.querySelectorAll('.github-input').forEach((input) => {
    input.disabled = !allowed;
  });

  const exportMd = panel.querySelector('[data-action="export-md"]');
  if (exportMd) exportMd.disabled = true;

  // 네비의 스토리 동기화도 동일 권한
  document.querySelectorAll('button[data-action="story-sync"]').forEach((btn) => {
    btn.disabled = !allowed;
    btn.title = allowed
      ? 'ST→인물·관계·타임라인·네비 동기화'
      : '일반 사용자는 사용할 수 없습니다';
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
