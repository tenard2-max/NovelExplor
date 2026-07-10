/** GitHub Contents API — 세션 메모리 PAT만 사용 (localStorage 금지) */

export const GITHUB_REPO = {
  owner: 'tenard2-max',
  repo: 'NovelExplor',
  branch: 'main',
};

/** @type {string} */
let sessionToken = '';

export function setSessionToken(token) {
  sessionToken = String(token || '').trim();
}

export function clearSessionToken() {
  sessionToken = '';
}

export function hasSessionToken() {
  return Boolean(sessionToken);
}

export function getRepoLabel() {
  return `${GITHUB_REPO.owner}/${GITHUB_REPO.repo}@${GITHUB_REPO.branch}`;
}

/**
 * @param {string} path  예: data/workspace/assets/stories/ST010.md
 * @param {string} contentText  UTF-8 텍스트
 * @param {string} message  커밋 메시지
 */
export async function putTextFile(path, contentText, message) {
  if (!sessionToken) throw new Error('GitHub PAT가 없습니다. 세션 토큰을 입력하세요.');

  const { owner, repo, branch } = GITHUB_REPO;
  const apiPath = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}`;
  const sha = await getFileSha(apiPath, branch);

  const body = {
    message,
    content: utf8ToBase64(contentText),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(apiPath, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GitHub 커밋 실패 (${path}): ${res.status} ${shortErr(errText)}`);
  }

  return res.json();
}

/**
 * 여러 텍스트 파일을 순차 커밋
 * @param {Array<{ path: string, content: string, message?: string }>} files
 * @param {string} baseMessage
 */
export async function putTextFiles(files, baseMessage) {
  const results = [];
  for (const file of files) {
    const msg = file.message || `${baseMessage}: ${file.path}`;
    results.push(await putTextFile(file.path, file.content, msg));
  }
  return results;
}

async function getFileSha(apiPath, branch) {
  const res = await fetch(`${apiPath}?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${sessionToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GitHub SHA 조회 실패: ${res.status} ${shortErr(errText)}`);
  }
  const data = await res.json();
  return data.sha || null;
}

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function shortErr(text) {
  try {
    const j = JSON.parse(text);
    return j.message || text.slice(0, 120);
  } catch {
    return String(text).slice(0, 120);
  }
}
