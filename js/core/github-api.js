/** GitHub REST API — Contents 읽기 + Git Trees 단일 커밋 */

import { getGithubConfig } from './github-config.js';

const API = 'https://api.github.com';

async function githubRequest(path, { method = 'GET', body, allow404 = false } = {}) {
  const { token } = getGithubConfig();
  if (!token?.trim()) {
    throw new Error('GitHub Personal Access Token이 설정되지 않았습니다. 우측 패널에서 연결하세요.');
  }

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token.trim()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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
    throw new Error(detail || `GitHub API 오류 (${res.status})`);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** 저장소 파일 SHA (없으면 null) */
export async function getRepoFileSha(repoPath) {
  const { owner, repo, branch } = getGithubConfig();
  const data = await githubRequest(
    `/repos/${owner}/${repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(branch)}`,
    { allow404: true }
  );
  return data?.sha || null;
}

/** Contents API — UTF-8 텍스트 또는 base64 원문 */
export async function getRepoFileContent(repoPath) {
  const { owner, repo, branch } = getGithubConfig();
  const data = await githubRequest(
    `/repos/${owner}/${repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(branch)}`,
    { allow404: true }
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
 */
export async function commitRepoFiles(files, message = 'NovelExplor sync') {
  if (!files?.length) throw new Error('커밋할 파일이 없습니다.');

  const { owner, repo, branch } = getGithubConfig();
  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const parentSha = ref.object.sha;
  const parentCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const baseTreeSha = parentCommit.tree.sha;

  const treeItems = [];
  const BATCH = 8;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const blobs = await Promise.all(batch.map(async (f) => {
      const blobBody = f.contentBase64
        ? { content: f.content, encoding: 'base64' }
        : { content: utf8ToBase64(f.content), encoding: 'base64' };
      return githubRequest(`/repos/${owner}/${repo}/git/blobs`, { method: 'POST', body: blobBody });
    }));
    batch.forEach((f, j) => {
      treeItems.push({
        path: f.repoPath,
        mode: '100644',
        type: 'blob',
        sha: blobs[j].sha,
      });
    });
  }

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

  return { commitSha: commit.sha, fileCount: files.length };
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
  const data = await githubRequest(`/repos/${owner}/${repo}`);
  return { fullName: data.full_name, defaultBranch: data.default_branch };
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
