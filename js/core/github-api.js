/** GitHub REST API — Contents API (PUT /repos/.../contents) */

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

/**
 * 파일 생성·수정 (커밋 1건당 파일 1개)
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

/** 여러 파일 순차 커밋 */
export async function putRepoFiles(files, messagePrefix = 'NovelExplor sync') {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const msg = files.length > 1
      ? `${messagePrefix} (${i + 1}/${files.length}) ${f.repoPath}`
      : `${messagePrefix} ${f.repoPath}`;
    results.push(await putRepoFile(f.repoPath, f.content, msg, {
      contentBase64: f.contentBase64 === true,
    }));
  }
  return results;
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
