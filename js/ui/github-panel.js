/** GitHub 연결 UI (우측 패널) */

import {
  getGithubConfig,
  saveGithubConfig,
  hasGithubToken,
  rawGithubUrl,
  snapshotsDir,
} from '../core/github-config.js';
import { testGithubConnection } from '../core/github-api.js';
import { syncProjectToGithub } from '../core/github-sync.js';
import { refreshNavVersionsFromGithub } from '../app-version.js';
import { showAlert } from './dialog.js';

export function initGithubPanel() {
  const tokenEl = document.getElementById('github-token');
  const ownerEl = document.getElementById('github-owner');
  const repoEl = document.getElementById('github-repo');
  const branchEl = document.getElementById('github-branch');
  const statusEl = document.getElementById('github-status');
  const saveBtn = document.querySelector('[data-action="github-save"]');
  const testBtn = document.querySelector('[data-action="github-test"]');
  const syncBtn = document.querySelector('[data-action="github-sync-now"]');

  if (!tokenEl) return;

  const cfg = getGithubConfig();
  ownerEl.value = cfg.owner;
  repoEl.value = cfg.repo;
  branchEl.value = cfg.branch;
  if (cfg.token) tokenEl.placeholder = '토큰 저장됨 (다시 입력하면 교체)';

  updateGithubStatus(statusEl);

  saveBtn?.addEventListener('click', () => {
    saveGithubConfig({
      owner: ownerEl.value.trim(),
      repo: repoEl.value.trim(),
      branch: branchEl.value.trim() || 'main',
      token: tokenEl.value.trim() || cfg.token,
    });
    tokenEl.value = '';
    tokenEl.placeholder = hasGithubToken() ? '토큰 저장됨' : 'ghp_...';
    updateGithubStatus(statusEl);
    showAlert('GitHub 설정', '저장했습니다. (토큰은 이 브라우저에만 보관)');
  });

  testBtn?.addEventListener('click', async () => {
    try {
      if (tokenEl.value.trim()) {
        saveGithubConfig({ token: tokenEl.value.trim() });
        tokenEl.value = '';
      }
      const info = await testGithubConnection();
      updateGithubStatus(statusEl, `연결됨: ${info.fullName}`);
      await refreshNavVersionsFromGithub();
    } catch (err) {
      updateGithubStatus(statusEl, `오류: ${err.message}`);
    }
  });

  syncBtn?.addEventListener('click', async () => {
    try {
      if (!hasGithubToken()) throw new Error('토큰을 먼저 저장하세요.');
      syncBtn.disabled = true;
      updateGithubStatus(statusEl, '동기화 중…');
      const result = await syncProjectToGithub({ reason: 'manual' });
      updateGithubStatus(statusEl, result
        ? `완료: ${result.snapshotId}.json (${result.fileCount}파일)`
        : '완료');
      await refreshNavVersionsFromGithub();
    } catch (err) {
      updateGithubStatus(statusEl, `실패: ${err.message}`);
    } finally {
      syncBtn.disabled = false;
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
