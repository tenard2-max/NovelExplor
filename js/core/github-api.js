/** GitHub REST API — Contents 읽기 + Git Trees 단일 커밋 */

import { getGithubConfig } from './github-config.js';

const API = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 45000;
const BLOB_TIMEOUT_MS = 90000;
const MAX_RETRIES = 2;
const BLOB_BATCH = 4;

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

      if (res.status === 404 && allow404) return null;

      if (!res.ok) {
        let detail = '';
        try {
          const err = await res.json();
          detail = err.message || '';
        } catch {
          /* ignore */
        }
        // rate limit / secondary rate — 재시도
        if ((res.status === 403 || res.status === 429) && attempt < retries) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new Error(detail || `GitHub API 오류 (${res.status})`);
      }

      if (res.status === 204) return null;
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (err) {
      lastError = err;
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
 * @returns {Promise<{ name: string, path: string, type: string, size: number, sha: string }[]>}
 */
export async function listRepoDir(repoPath) {
  const { owner, repo, branch } = getGithubConfig();
  const data = await githubRequest(
    `/repos/${owner}/${repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(branch)}`,
    { allow404: true, allowPublic: true }
  );
  if (!data) return [];
  if (!Array.isArray(data)) {
    throw new Error(`디렉터리가 아닙니다: ${repoPath}`);
  }
  return data.map((item) => ({
    name: item.name,
    path: item.path,
    type: item.type,
    size: item.size || 0,
    sha: item.sha,
  }));
}

export async function getRepoFileText(repoPath) {
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

  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const parentSha = ref.object.sha;
  const parentCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const baseTreeSha = parentCommit.tree.sha;

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

  reportProgress(onProgress, {
    phase: 'tree',
    done: total,
    total,
    label: `트리 생성… (${total}파일)`,
  });
  const tree = await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree: treeItems },
  });

  reportProgress(onProgress, {
    phase: 'commit',
    done: total,
    total,
    label: '커밋 중…',
  });
  const commit = await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: {
      message,
      tree: tree.sha,
      parents: [parentSha],
    },
  });

  reportProgress(onProgress, {
    phase: 'ref',
    done: total,
    total,
    label: '브랜치 갱신…',
  });
  await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha: commit.sha },
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
  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const parentSha = ref.object.sha;
  const parentCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const baseTreeSha = parentCommit.tree.sha;

  const treeItems = paths.map((path) => ({
    path,
    mode: '100644',
    type: 'blob',
    sha: null,
  }));

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

  await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha: commit.sha },
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
