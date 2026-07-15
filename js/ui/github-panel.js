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
import {
  beginGithubOperation,
  endGithubOperation,
} from '../core/github-metrics.js';

function assertMasterGithub() {
  if (canSetDefaultProject()) return true;
  alert('GitHub 설정은 마스터만 사용할 수 있습니다.');
  return false;
}

const RESET_REFRESH_MS = 1000;
let resetRefreshTimer = null;

function formatResetRemaining(resetAt) {
  if (!resetAt) return null;
  const d = resetAt instanceof Date ? resetAt : new Date(Number(resetAt) * 1000);
  if (Number.isNaN(d.getTime())) return null;

  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return '—';

  const totalSec = Math.ceil(diffMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `리셋 ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function syncResetRefreshTimer() {
  const rl = getGithubRateLimit();
  const resetAt = rl?.resetAt instanceof Date ? rl.resetAt : rl?.resetAt ? new Date(rl.resetAt) : null;
  const shouldRun = !document.hidden && resetAt && !Number.isNaN(resetAt.getTime()) && resetAt.getTime() > Date.now();

  if (shouldRun) {
    if (resetRefreshTimer == null) {
      resetRefreshTimer = window.setInterval(updateRateLimitDisplay, RESET_REFRESH_MS);
    }
  } else if (resetRefreshTimer != null) {
    window.clearInterval(resetRefreshTimer);
    resetRefreshTimer = null;
  }
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
    resetEl.textContent = rl?.resetAt ? (formatResetRemaining(rl.resetAt) ?? '—') : '';
  }

  syncResetRefreshTimer();
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
  document.addEventListener('visibilitychange', () => {
    syncResetRefreshTimer();
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
    const openMetrics = beginGithubOperation('project-open');
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
      endGithubOperation(openMetrics);
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
