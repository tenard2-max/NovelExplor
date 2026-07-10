/** GitHub 저장소 설정 (PAT는 localStorage, 저장소에 커밋하지 않음) */

const STORAGE_KEY = 'fft-github-config';

const DEFAULTS = {
  owner: 'tenard2-max',
  repo: 'NovelExplor',
  branch: 'main',
  workspaceRoot: 'data/workspace',
};

/** @returns {{ owner: string, repo: string, branch: string, workspaceRoot: string, token: string }} */
export function getGithubConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    saved = {};
  }
  const inferred = inferRepoFromPagesUrl();
  return {
    owner: saved.owner || inferred.owner || DEFAULTS.owner,
    repo: saved.repo || inferred.repo || DEFAULTS.repo,
    branch: saved.branch || DEFAULTS.branch,
    workspaceRoot: saved.workspaceRoot || DEFAULTS.workspaceRoot,
    token: saved.token || '',
  };
}

export function saveGithubConfig(partial) {
  const next = { ...getGithubConfig(), ...partial };
  const toStore = {
    owner: next.owner,
    repo: next.repo,
    branch: next.branch,
    workspaceRoot: next.workspaceRoot,
    token: next.token,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  return toStore;
}

export function hasGithubToken() {
  return Boolean(getGithubConfig().token?.trim());
}

export function inferRepoFromPagesUrl() {
  const { hostname, pathname } = window.location;
  if (hostname.endsWith('github.io')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 1) {
      const owner = hostname.replace('.github.io', '');
      return { owner, repo: parts[0] };
    }
  }
  return { owner: DEFAULTS.owner, repo: DEFAULTS.repo };
}

export function snapshotsDir(cfg = getGithubConfig()) {
  return `${cfg.workspaceRoot}/snapshots`;
}

export function overlaysDir(cfg = getGithubConfig()) {
  return `${cfg.workspaceRoot}/overlays`;
}

export function rawGithubUrl(repoPath, cfg = getGithubConfig()) {
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${repoPath}`;
}
