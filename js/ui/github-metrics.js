/** 전 사용자 GitHub API/raw 호출 계측 표시 */

import { on } from '../core/events.js';
import {
  getGithubMetrics,
  initGithubMetrics,
} from '../core/github-metrics.js';

export function initGithubMetricsUi() {
  initGithubMetrics();
  on('github:metrics', renderGithubMetrics);
  on('github:open-api-warning', ({ apiCalls }) => {
    const el = document.getElementById('nav-github-metrics');
    if (el) {
      el.classList.add('is-warning');
      el.title = `프로젝트 열기 중 API ${apiCalls}회 호출 — 대량 호출 경로를 확인하세요.`;
    }
  });
  renderGithubMetrics(getGithubMetrics());
}

function renderGithubMetrics(metrics) {
  const el = document.getElementById('nav-github-metrics');
  if (!el) return;
  const warningEl = document.getElementById('nav-github-warning');

  const api = Number(metrics?.apiCalls) || 0;
  const raw = Number(metrics?.rawDownloads) || 0;
  const remaining = metrics?.rateLimit?.remaining;
  const limit = metrics?.rateLimit?.limit;
  const limitText = Number.isFinite(remaining) && Number.isFinite(limit)
    ? ` · LIMIT ${remaining}/${limit}`
    : '';

  el.textContent = `NET: API ${api} · RAW ${raw}${limitText}`;
  el.classList.toggle('is-warning', Boolean(metrics?.warning));
  if (warningEl) {
    warningEl.hidden = !metrics?.warning;
    warningEl.textContent = metrics?.warning ? `⚠ ${metrics.warning}` : '';
  }

  const details = [];
  details.push('API = api.github.com 실제 요청(재시도 포함)');
  details.push('RAW = raw.githubusercontent.com 네트워크 다운로드(캐시 적중 제외)');
  if (metrics?.lastOperation?.label === 'project-open') {
    details.push(
      `최근 열기: API ${metrics.lastOperation.apiCalls} · RAW ${metrics.lastOperation.rawDownloads}`
    );
  }
  if (metrics?.warning) details.push(`경고: ${metrics.warning}`);
  el.title = details.join('\n');
}
