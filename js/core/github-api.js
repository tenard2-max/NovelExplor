/** GitHub REST API — Contents 읽기 + Git Trees 단일 커밋 */

import { getGithubConfig, rawGithubUrl } from './github-config.js';
import { emit } from './events.js';

const API = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 45000;
const BLOB_TIMEOUT_MS = 90000;
const MAX_RETRIES = 2;
const BLOB_BATCH = 4;
const REF_FAST_FORWARD_RETRIES = 2;
const DIR_CACHE_TTL_MS = 5 * 60 * 1000;
const DIR_CACHE_PREFIX = 'ne-gh-dir:';

/** @type {Map<string, { at: number, entries: object[] }>} */
const dirMemoryCache = new Map();

/** @type {{ limit?: number, remaining?: number, resetAt?: Date } | null} */
let rateLimitCache = null;

function updateRateLimitFromHeaders(res) {
  const limit = res.headers.get('X-RateLimit-Limit');
  const remaining = res.headers.get('X-RateLimit-Remaining');
  const reset = res.headers.get('X-RateLimit-Reset');
  if (limit == null && remaining == null && reset == null) return;

  const next = { ...(rateLimitCache || {}) };
  if (limit != null && !Number.isNaN(Number(limit))) next.limit = Number(limit);
  if (remaining != null && !Number.isNaN(Number(remaining))) next.remaining = Number(remaining);
  if (reset != null && !Number.isNaN(Number(reset))) {
    next.resetAt = new Date(Number(reset) * 1000);
  }
  rateLimitCache = next;
  emit('github:rate-limit', getGithubRateLimit());
}

/** @returns {{ limit?: number, remaining?: number, resetAt?: Date } | null} */
export function getGithubRateLimit() {
  if (!rateLimitCache) return null;
  return { ...rateLimitCache };
}

/** GET /rate_limit — 연결 테스트 등에서 헤더 없이도 한도 표시 */
export async function fetchGithubRateLimit() {
  const data = await githubRequest('/rate_limit');
  if (data?.rate) {
    rateLimitCache = {
      limit: data.rate.limit,
      remaining: data.rate.remaining,
      resetAt: new Date(data.rate.reset * 1000),
    };
    emit('github:rate-limit', getGithubRateLimit());
  }
  return getGithubRateLimit();
}

function formatGithubApiError(status, detail) {
  const d = String(detail || '');
  if (status === 403 || status === 429 || /rate limit/i.test(d)) {
    return 'GitHub API 호출 한도 초과. 우측 패널에 PAT를 연결하면 한도가 크게 늘어납니다.';
  }
  if (/not a fast.?forward|fast.?forward/i.test(d)) {
    return 'GitHub 원격 브랜치가 다른 곳에서 먼저 갱신되었습니다. 잠시 후 다시 동기화해 주세요.';
  }
  return d || `GitHub API 오류 (${status})`;
}

export function isGithubRateLimitError(err) {
  const msg = String(err?.message || err || '');
  return /한도 초과|rate limit/i.test(msg);
}

export function isGithubNonFastForwardError(err) {
  const msg = String(err?.message || err || '');
  return /not a fast.?forward|fast.?forward|먼저 갱신/i.test(msg);
}

const GITHUB_SYNC_CONFLICT_MESSAGE =
  '동기화 충돌: 원격 브랜치에 다른 커밋이 반영되어 자동 재시도 후에도 실패했습니다. 잠시 후 다시 시도하거나 GitHub에서 브랜치 상태를 확인해 주세요.';

async function getBranchTip(owner, repo, branch) {
  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const parentSha = ref.object.sha;
  const parentCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
  return { parentSha, baseTreeSha: parentCommit.tree.sha };
}

async function buildTreeAndCommit(owner, repo, { message, baseTreeSha, treeItems, parentSha }) {
  const tree = await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree: treeItems },
  });
  const commit = await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: {
      message,
      tree: tree.sha,
      parents: [parentSha],
    },
  });
  return commit;
}

async function patchBranchRef(owner, repo, branch, commitSha) {
  await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha: commitSha },
  });
}

/**
 * 최신 브랜치 tip 기준으로 tree/commit/ref 갱신. non-fast-forward 시 재시도.
 */
async function commitTreeWithRetry(owner, repo, branch, {
  message,
  treeItems,
  onProgress,
  progressTotal,
}) {
  let lastError;

  for (let attempt = 0; attempt <= REF_FAST_FORWARD_RETRIES; attempt++) {
    if (attempt > 0) {
      reportProgress(onProgress, {
        phase: 'ref-retry',
        done: progressTotal,
        total: progressTotal,
        label: `브랜치 충돌 — 재시도 ${attempt}/${REF_FAST_FORWARD_RETRIES}…`,
      });
      await sleep(400 * attempt);
    }

    const { parentSha, baseTreeSha } = await getBranchTip(owner, repo, branch);

    reportProgress(onProgress, {
      phase: attempt > 0 ? 'tree-retry' : 'tree',
      done: progressTotal,
      total: progressTotal,
      label: attempt > 0
        ? `트리 재생성… (${progressTotal}파일)`
        : `트리 생성… (${progressTotal}파일)`,
    });

    reportProgress(onProgress, {
      phase: attempt > 0 ? 'commit-retry' : 'commit',
      done: progressTotal,
      total: progressTotal,
      label: attempt > 0 ? '커밋 재시도…' : '커밋 중…',
    });

    let commit;
    try {
      commit = await buildTreeAndCommit(owner, repo, {
        message,
        baseTreeSha,
        treeItems,
        parentSha,
      });
    } catch (err) {
      lastError = err;
      if (isGithubNonFastForwardError(err) && attempt < REF_FAST_FORWARD_RETRIES) continue;
      throw err;
    }

    reportProgress(onProgress, {
      phase: 'ref',
      done: progressTotal,
      total: progressTotal,
      label: attempt > 0 ? '브랜치 재갱신…' : '브랜치 갱신…',
    });

    try {
      await patchBranchRef(owner, repo, branch, commit.sha);
      return commit;
    } catch (err) {
      lastError = err;
      if (isGithubNonFastForwardError(err) && attempt < REF_FAST_FORWARD_RETRIES) continue;
      if (isGithubNonFastForwardError(err)) {
        throw new Error(GITHUB_SYNC_CONFLICT_MESSAGE);
      }
      throw err;
    }
  }

  throw lastError || new Error(GITHUB_SYNC_CONFLICT_MESSAGE);
}

async function githubRequest(path, {
  method = 'GET',
  body,
  allow404 = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = MAX_RETRIES,
  allowPublic = false,
} = {}) {
  const { token } = getGithubConfig();
  const hasToken = Boolean(token?.trim());
  if (!hasToken && method !== 'GET') {
    throw new Error('GitHub Personal Access Token이 설정되지 않았습니다. 우측 패널에서 연결하세요.');
  }
  if (!hasToken && !allowPublic && method === 'GET') {
    throw new Error('GitHub Personal Access Token이 설정되지 않았습니다. 우측 패널에서 연결하세요.');
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      };
      if (hasToken) headers.Authorization = `Bearer ${token.trim()}`;

      const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      updateRateLimitFromHeaders(res);

      if (res.status === 404 && allow404) return null;

      if (!res.ok) {
        let detail = '';
        try {
          const err = await res.json();
          detail = err.message || '';
        } catch {
          /* ignore */
        }
        const isRate = res.status === 403 || res.status === 429 || /rate limit/i.test(detail);
        // rate limit 은 재시도해도 거의 동일 — 한 번만 짧게 재시도
        if (isRate && attempt < retries && attempt === 0) {
          await sleep(1200);
          continue;
        }
        throw new Error(formatGithubApiError(res.status, detail));
      }

      if (res.status === 204) return null;
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (err) {
      lastError = err;
      if (err?.message && /한도 초과|rate limit|토큰/i.test(err.message)) {
        throw err;
      }
      const aborted = err?.name === 'AbortError';
      const network = err instanceof TypeError;
      if ((aborted || network) && attempt < retries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (aborted) {
        throw new Error(`GitHub 요청 타임아웃 (${Math.round(timeoutMs / 1000)}초)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('GitHub 요청 실패');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function reportProgress(onProgress, payload) {
  if (typeof onProgress === 'function') onProgress(payload);
}

/** 저장소 파일 SHA (없으면 null) */
export async function getRepoFileSha(repoPath) {
  const { owner, repo, branch } = getGithubConfig();
  const data = await githubRequest(
    `/repos/${owner}/${repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(branch)}`,
    { allow404: true, allowPublic: true }
  );
  return data?.sha || null;
}

/** Contents API — UTF-8 텍스트 또는 base64 원문 */
export async function getRepoFileContent(repoPath) {
  const { owner, repo, branch } = getGithubConfig();
  const data = await githubRequest(
    `/repos/${owner}/${repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(branch)}`,
    { allow404: true, allowPublic: true }
  );
  if (!data) return null;

  // 1MB 초과 등은 content 없이 download_url 만 오는 경우
  if (!data.content && data.download_url) {
    const res = await fetch(data.download_url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`GitHub 파일 다운로드 실패 (${res.status}): ${repoPath}`);
    const text = await res.text();
    const isText = !/\.(png|jpg|jpeg|gif|webp|zip)$/i.test(repoPath);
    return {
      sha: data.sha,
      size: data.size || text.length,
      contentBase64: '',
      content: text,
      isText,
    };
  }

  const raw = String(data.content || '').replace(/\n/g, '');
  const isText = !/\.(png|jpg|jpeg|gif|webp|zip)$/i.test(repoPath);

  return {
    sha: data.sha,
    size: data.size,
    contentBase64: raw,
    content: isText ? base64ToUtf8(raw) : raw,
    isText,
  };
}

/**
 * 디렉터리 목록 (공개 저장소는 PAT 없이 가능)
 * 5분 세션 캐시로 중복 Contents API 호출을 줄임
 * @returns {Promise<{ name: string, path: string, type: string, size: number, sha: string }[]>}
 */
export async function listRepoDir(repoPath) {
  const { owner, repo, branch } = getGithubConfig();
  const cacheKey = `${DIR_CACHE_PREFIX}${owner}/${repo}/${branch}:${repoPath}`;

  const mem = dirMemoryCache.get(cacheKey);
  if (mem && Date.now() - mem.at < DIR_CACHE_TTL_MS) {
    return mem.entries;
  }
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.at && Date.now() - parsed.at < DIR_CACHE_TTL_MS && Array.isArray(parsed.entries)) {
        dirMemoryCache.set(cacheKey, parsed);
        return parsed.entries;
      }
    }
  } catch { /* private mode 등 */ }

  const data = await githubRequest(
    `/repos/${owner}/${repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(branch)}`,
    { allow404: true, allowPublic: true }
  );
  if (!data) return [];
  if (!Array.isArray(data)) {
    throw new Error(`디렉터리가 아닙니다: ${repoPath}`);
  }
  const entries = data.map((item) => ({
    name: item.name,
    path: item.path,
    type: item.type,
    size: item.size || 0,
    sha: item.sha,
  }));

  const payload = { at: Date.now(), entries };
  dirMemoryCache.set(cacheKey, payload);
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch { /* quota */ }
  return entries;
}

export async function getRepoFileText(repoPath) {
  // 공개 raw URL 우선 — Contents API 쿼터·base64 오버헤드 회피
  try {
    const res = await fetch(rawGithubUrl(repoPath), { cache: 'no-store' });
    if (res.ok) return await res.text();
  } catch {
    /* fall through to API */
  }

  const item = await getRepoFileContent(repoPath);
  if (!item) throw new Error(`GitHub 파일 없음: ${repoPath}`);
  return item.content;
}

export async function getRepoFileBase64(repoPath) {
  const item = await getRepoFileContent(repoPath);
  if (!item) throw new Error(`GitHub 파일 없음: ${repoPath}`);
  return item.contentBase64;
}

export async function getRepoFileJson(repoPath) {
  const text = await getRepoFileText(repoPath);
  return JSON.parse(text);
}

/**
 * 파일 생성·수정 (커밋 1건당 파일 1개) — 단일 파일용
 */
export async function putRepoFile(repoPath, content, message, {
  contentBase64 = false,
  sha = undefined,
} = {}) {
  const { owner, repo, branch } = getGithubConfig();
  const path = encodeRepoPath(repoPath);
  const existingSha = sha !== undefined ? sha : await getRepoFileSha(repoPath);

  const body = {
    message,
    content: contentBase64 ? content : utf8ToBase64(content),
    branch,
  };
  if (existingSha) body.sha = existingSha;

  return githubRequest(`/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body,
  });
}

/**
 * 여러 파일을 한 커밋으로 푸시 (Git Trees API)
 * @param {{ repoPath: string, content: string, contentBase64?: boolean }[]} files
 * @param {string} message
 * @param {{ onProgress?: (p: object) => void }} [options]
 */
export async function commitRepoFiles(files, message = 'NovelExplor sync', options = {}) {
  if (!files?.length) throw new Error('커밋할 파일이 없습니다.');

  const onProgress = options.onProgress;
  const total = files.length;
  const { owner, repo, branch } = getGithubConfig();

  reportProgress(onProgress, {
    phase: 'prepare',
    done: 0,
    total,
    label: `준비 중… (0/${total})`,
  });

  const treeItems = [];
  let done = 0;

  for (let i = 0; i < files.length; i += BLOB_BATCH) {
    const batch = files.slice(i, i + BLOB_BATCH);
    const blobs = await Promise.all(batch.map(async (f) => {
      const blobBody = f.contentBase64
        ? { content: f.content, encoding: 'base64' }
        : { content: utf8ToBase64(f.content), encoding: 'base64' };
      return githubRequest(`/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        body: blobBody,
        timeoutMs: BLOB_TIMEOUT_MS,
        retries: MAX_RETRIES,
      });
    }));

    batch.forEach((f, j) => {
      treeItems.push({
        path: f.repoPath,
        mode: '100644',
        type: 'blob',
        sha: blobs[j].sha,
      });
      done += 1;
      const short = shortPath(f.repoPath);
      const pct = Math.round((done / total) * 100);
      reportProgress(onProgress, {
        phase: 'blobs',
        done,
        total,
        file: f.repoPath,
        label: `업로드 ${done}/${total} (${pct}%) ${short}`,
      });
    });
  }

  const commit = await commitTreeWithRetry(owner, repo, branch, {
    message,
    treeItems,
    onProgress,
    progressTotal: total,
  });

  reportProgress(onProgress, {
    phase: 'done',
    done: total,
    total,
    label: `완료 ${total}파일 (100%)`,
  });

  return { commitSha: commit.sha, fileCount: files.length };
}

/**
 * 저장소 경로 삭제 (한 커밋). Git Trees 에서 sha: null 로 제거.
 * @param {string[]} repoPaths
 * @param {string} [message]
 */
export async function deleteRepoPaths(repoPaths, message = 'NovelExplor: delete files') {
  const paths = [...new Set((repoPaths || []).map((p) => String(p || '').trim()).filter(Boolean))];
  if (!paths.length) throw new Error('삭제할 파일이 없습니다.');

  const { owner, repo, branch } = getGithubConfig();

  const treeItems = paths.map((path) => ({
    path,
    mode: '100644',
    type: 'blob',
    sha: null,
  }));

  const commit = await commitTreeWithRetry(owner, repo, branch, {
    message,
    treeItems,
    progressTotal: paths.length,
  });

  return { commitSha: commit.sha, fileCount: paths.length };
}

/** @deprecated commitRepoFiles 사용 */
export async function putRepoFiles(files, messagePrefix = 'NovelExplor sync') {
  const msg = files.length > 1
    ? `${messagePrefix} (${files.length} files)`
    : `${messagePrefix} ${files[0]?.repoPath || ''}`;
  return commitRepoFiles(files, msg);
}

export async function testGithubConnection() {
  const { owner, repo } = getGithubConfig();
  const data = await githubRequest(`/repos/${owner}/${repo}`, { allowPublic: true });
  if (getGithubConfig().token?.trim()) {
    try {
      await fetchGithubRateLimit();
    } catch {
      /* repo 테스트는 성공 — rate_limit 은 부가 정보 */
    }
  }
  return { fullName: data.full_name, defaultBranch: data.default_branch };
}

function shortPath(repoPath) {
  const parts = String(repoPath).split('/');
  return parts[parts.length - 1] || repoPath;
}

function encodeRepoPath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
