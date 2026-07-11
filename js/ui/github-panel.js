/** GitHub 연결 UI (우측 패널) — 마스터 전용 */

import {
  getGithubConfig,
  saveGithubConfig,
  hasGithubToken,
  rawGithubUrl,
  snapshotsDir,
} from '../core/github-config.js';
import { testGithubConnection, getGithubRateLimit } from '../core/github-api.js';
import { syncProjectToGithub } from '../core/github-sync.js';
import { pullProjectFromGithubWithAlert } from '../core/github-pull.js';
import { refreshNavVersionsFromGithub } from '../app-version.js';
import { canSetDefaultProject } from '../core/auth.js';
import { showAlert } from './dialog.js';
import { on } from '../core/events.js';

function assertMasterGithub() {
  if (canSetDefaultProject()) return true;
  alert('GitHub 설정은 마스터만 사용할 수 있습니다.');
  return false;
}

function formatResetTime(resetAt) {
  if (!resetAt) return '';
  const d = resetAt instanceof Date ? resetAt : new Date(Number(resetAt) * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `리셋 ${hh}:${mm}`;
}

function updateRateLimitDisplay() {
  const quotaEl = document.getElementById('github-rate-quota');
  const resetEl = document.getElementById('github-rate-reset');
  const rl = getGithubRateLimit();

  if (quotaEl) {
    if (rl?.remaining != null && rl?.limit != null) {
      quotaEl.textContent = `${rl.remaining}/${rl.limit}`;
    } else {
      quotaEl.textContent = '';
    }
  }

  if (resetEl) {
    const resetStr = formatResetTime(rl?.resetAt);
    resetEl.textContent = resetStr || '';
  }
}

function updateTokenPlaceholder(tokenEl) {
  if (!tokenEl) return;
  tokenEl.placeholder = hasGithubToken() ? '토큰 저장됨' : 'ghp_...';
}

export function initGithubPanel() {
  const tokenEl = document.getElementById('github-token');
  const ownerEl = document.getElementById('github-owner');
  const repoEl = document.getElementById('github-repo');
  const branchEl = document.getElementById('github-branch');
  const statusEl = document.getElementById('github-status');
  const saveBtn = document.querySelector('[data-action="github-save"]');
  const testBtn = document.querySelector('[data-action="github-test"]');
  const syncBtn = document.querySelector('[data-action="github-sync-now"]');
  const pullBtn = document.querySelector('[data-action="github-pull"]');

  if (!tokenEl) return;

  const cfg = getGithubConfig();
  ownerEl.value = cfg.owner;
  repoEl.value = cfg.repo;
  branchEl.value = cfg.branch;
  updateTokenPlaceholder(tokenEl);
  updateRateLimitDisplay();
  updateGithubStatus(statusEl);

  on('github:rate-limit', () => {
    updateRateLimitDisplay();
  });
  on('github:sync-progress', (p) => {
    if (p?.label) updateGithubStatus(statusEl, p.label);
  });
  on('github:sync-error', (err) => {
    updateGithubStatus(statusEl, `실패: ${err?.message || err}`);
  });

  saveBtn?.addEventListener('click', () => {
    if (!assertMasterGithub()) return;
    saveGithubConfig({
      owner: ownerEl.value.trim(),
      repo: repoEl.value.trim(),
      branch: branchEl.value.trim() || 'main',
      token: tokenEl.value.trim() || cfg.token,
    });
    tokenEl.value = '';
    updateTokenPlaceholder(tokenEl);
    updateGithubStatus(statusEl);
    showAlert('GitHub 설정', '저장했습니다. (토큰은 이 브라우저에만 보관)');
  });

  testBtn?.addEventListener('click', async () => {
    if (!assertMasterGithub()) return;
    try {
      if (tokenEl.value.trim()) {
        saveGithubConfig({ token: tokenEl.value.trim() });
        tokenEl.value = '';
        updateTokenPlaceholder(tokenEl);
      }
      const info = await testGithubConnection();
      updateRateLimitDisplay();
      updateGithubStatus(statusEl, `연결됨: ${info.fullName}`);
      await refreshNavVersionsFromGithub();
    } catch (err) {
      updateRateLimitDisplay();
      updateGithubStatus(statusEl, `오류: ${err.message}`);
    }
  });

  syncBtn?.addEventListener('click', async () => {
    if (!assertMasterGithub()) return;
    try {
      if (!hasGithubToken()) throw new Error('토큰을 먼저 저장하세요.');
      syncBtn.disabled = true;
      if (pullBtn) pullBtn.disabled = true;
      updateGithubStatus(statusEl, '동기화 중…');
      const result = await syncProjectToGithub({ reason: 'manual' });
      updateRateLimitDisplay();
      updateGithubStatus(statusEl, result
        ? `완료: ${result.snapshotId}.json (${result.fileCount}파일, 1커밋)`
        : '완료');
      await refreshNavVersionsFromGithub();
    } catch (err) {
      updateRateLimitDisplay();
      updateGithubStatus(statusEl, `실패: ${err.message}`);
    } finally {
      syncBtn.disabled = false;
      if (pullBtn) pullBtn.disabled = false;
    }
  });

  pullBtn?.addEventListener('click', async () => {
    if (!assertMasterGithub()) return;
    try {
      if (!hasGithubToken()) throw new Error('토큰을 먼저 저장하세요.');
      pullBtn.disabled = true;
      if (syncBtn) syncBtn.disabled = true;
      updateGithubStatus(statusEl, 'Pull 중…');
      const id = await pullProjectFromGithubWithAlert();
      updateRateLimitDisplay();
      updateGithubStatus(statusEl, id
        ? `Pull 완료: ${id}.json`
        : '취소됨');
    } catch (err) {
      updateRateLimitDisplay();
      updateGithubStatus(statusEl, `Pull 실패: ${err.message}`);
    } finally {
      pullBtn.disabled = false;
      if (syncBtn) syncBtn.disabled = false;
    }
  });
}

function updateGithubStatus(el, msg = '') {
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    return;
  }
  const cfg = getGithubConfig();
  if (!hasGithubToken()) {
    el.textContent = '미연결 — PAT( repo 권한 ) 필요';
    return;
  }
  el.textContent = `${cfg.owner}/${cfg.repo}@${cfg.branch}`;
  el.title = rawGithubUrl(`${snapshotsDir()}/latest.json`);
}
