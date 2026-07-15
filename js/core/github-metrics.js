/** GitHub REST API / raw 네트워크 다운로드 세션 계측 */

import { emit } from './events.js';

export const OPEN_API_WARNING_THRESHOLD = 10;
export const ANONYMOUS_LIMIT_WARNING_REMAINING = 10;

const state = {
  apiCalls: 0,
  rawDownloads: 0,
  rateLimit: null,
  lastOperation: null,
  warning: '',
};

/** @type {Map<symbol, { label: string, apiCalls: number, rawDownloads: number, warned: boolean }>} */
const operations = new Map();

let initialized = false;

export function initGithubMetrics() {
  if (initialized) return;
  initialized = true;

  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'ne:raw-download') {
        recordRawDownload({ source: 'service-worker' });
      }
    });
  }
  emitMetrics();
}

export function beginGithubOperation(label) {
  const token = Symbol(label);
  operations.set(token, {
    label: String(label || 'operation'),
    apiCalls: 0,
    rawDownloads: 0,
    warned: false,
  });
  return token;
}

export function endGithubOperation(token) {
  const operation = operations.get(token);
  if (!operation) return null;
  operations.delete(token);
  state.lastOperation = { ...operation };
  emitMetrics();
  return { ...operation };
}

/** 실제 fetch 시도 1회마다 호출한다. 재시도도 GitHub 한도를 소모하므로 별도 집계한다. */
export function recordGithubApiCall({ path = '', method = 'GET', attempt = 0 } = {}) {
  state.apiCalls += 1;

  for (const operation of operations.values()) {
    operation.apiCalls += 1;
    if (
      operation.label === 'project-open'
      && !operation.warned
      && operation.apiCalls >= OPEN_API_WARNING_THRESHOLD
    ) {
      operation.warned = true;
      setWarning(
        `프로젝트 열기 중 GitHub API ${operation.apiCalls}회 호출 감지`
      );
      emit('github:open-api-warning', {
        apiCalls: operation.apiCalls,
        threshold: OPEN_API_WARNING_THRESHOLD,
        path,
        method,
        attempt,
      });
    }
  }
  emitMetrics();
}

/** 네트워크에서 실제 raw 응답을 받은 경우만 집계(캐시 적중은 제외). */
export function recordRawDownload() {
  state.rawDownloads += 1;
  for (const operation of operations.values()) operation.rawDownloads += 1;
  emitMetrics();
}

/**
 * raw.githubusercontent.com fetch 공용 래퍼.
 * 서비스워커 제어 전 첫 로드에서도 raw 네트워크 다운로드를 누락하지 않는다.
 */
export async function trackedRawFetch(input, init) {
  const response = await fetch(input, init);
  let isRaw = false;
  try {
    const value = typeof input === 'string' ? input : input?.url;
    isRaw = new URL(value, globalThis.location?.href).hostname === 'raw.githubusercontent.com';
  } catch {
    isRaw = false;
  }
  if (
    response?.ok
    && isRaw
    && (
      typeof navigator === 'undefined'
      || !navigator.serviceWorker?.controller
    )
  ) {
    recordRawDownload();
  }
  return response;
}

export function updateGithubRateLimitMetrics(rateLimit) {
  state.rateLimit = rateLimit ? { ...rateLimit } : null;
  const limit = Number(rateLimit?.limit);
  const remaining = Number(rateLimit?.remaining);
  if (
    limit > 0
    && limit <= 60
    && Number.isFinite(remaining)
    && remaining <= ANONYMOUS_LIMIT_WARNING_REMAINING
  ) {
    setWarning(`GitHub API 비인증 한도 잔여 ${remaining}/${limit}`);
  } else if (state.warning.startsWith('GitHub API 비인증 한도')) {
    state.warning = '';
  }
  emitMetrics();
}

export function getGithubMetrics() {
  return {
    apiCalls: state.apiCalls,
    rawDownloads: state.rawDownloads,
    rateLimit: state.rateLimit ? { ...state.rateLimit } : null,
    lastOperation: state.lastOperation ? { ...state.lastOperation } : null,
    warning: state.warning,
  };
}

function setWarning(message) {
  state.warning = String(message || '');
  console.warn(`[github-metrics] ${state.warning}`);
}

function emitMetrics() {
  emit('github:metrics', getGithubMetrics());
}
