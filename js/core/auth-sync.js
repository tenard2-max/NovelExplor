/** 마스터 인증 — GitHub SoT 동기화 (기기·브라우저 공통 비밀번호) */

import * as storage from './storage.js';
import { putRepoFile } from './github-api.js';
import { getGithubConfig, hasGithubToken, rawGithubUrl } from './github-config.js';
import { nowIso } from './utils.js';

const AUTH_FORMAT = 'master-auth/v1';
const MASTER_ROLE = 'admin_master';
export const MASTER_USERNAME = 'master';

export function masterAuthPath(cfg = getGithubConfig()) {
  return `${cfg.workspaceRoot}/auth/master-auth.json`;
}

/** GitHub master-auth.json (토큰 불필요, 공개 raw) */
export async function fetchRemoteMasterAuth() {
  try {
    const url = rawGithubUrl(masterAuthPath());
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.passwordHash || !data?.salt) return null;
    return data;
  } catch {
    return null;
  }
}

async function getMasterRecord() {
  const users = await storage.getAll('users');
  return users.find((u) => u.role === MASTER_ROLE) || null;
}

function isRemoteNewer(local, remote) {
  if (!remote?.updatedAt) return true;
  if (!local?.updatedAt) return true;
  return new Date(remote.updatedAt).getTime() > new Date(local.updatedAt).getTime();
}

/** 원격 마스터 해시 → 로컬 IndexedDB */
export async function applyRemoteMasterAuth(remote) {
  if (!remote?.passwordHash || !remote?.salt) return false;

  let master = await getMasterRecord();
  if (!master) {
    master = {
      id: 'user-master',
      role: MASTER_ROLE,
      disabled: false,
      createdAt: nowIso(),
    };
  }

  master.usernameHash = remote.usernameHash;
  master.usernameEnc = remote.usernameEnc;
  master.passwordHash = remote.passwordHash;
  master.salt = remote.salt;
  master.mustChangePassword = !!remote.mustChangePassword;
  master.updatedAt = remote.updatedAt || nowIso();
  delete master.username;

  await storage.put('users', master);
  return true;
}

/**
 * GitHub → 로컬 마스터 (원격이 더 최신일 때만)
 * @returns {Promise<boolean>} 적용 여부
 */
export async function syncMasterAuthFromGithub() {
  const remote = await fetchRemoteMasterAuth();
  if (!remote) return false;

  const local = await getMasterRecord();
  if (local && !isRemoteNewer(local, remote)) return false;

  return applyRemoteMasterAuth(remote);
}

/** 로컬 마스터 → GitHub (비밀번호 변경 시) */
export async function pushMasterAuthToGithub() {
  const master = await getMasterRecord();
  if (!master?.passwordHash || !master?.salt) return false;

  const payload = {
    format: AUTH_FORMAT,
    usernameHash: master.usernameHash,
    usernameEnc: master.usernameEnc,
    passwordHash: master.passwordHash,
    salt: master.salt,
    mustChangePassword: !!master.mustChangePassword,
    updatedAt: master.updatedAt || nowIso(),
  };

  if (hasGithubToken()) {
    await putRepoFile(
      masterAuthPath(),
      JSON.stringify(payload, null, 2),
      'NovelExplor: master auth sync'
    );
    return true;
  }
  return false;
}

/** 로컬이 등록 완료·원격 없음/구버전이면 GitHub에 반영 */
export async function ensureMasterAuthPublished() {
  if (!hasGithubToken()) return false;

  const master = await getMasterRecord();
  if (!master?.passwordHash || master.mustChangePassword) return false;

  const remote = await fetchRemoteMasterAuth();
  if (remote?.passwordHash === master.passwordHash) return false;
  if (remote && !isRemoteNewer(master, remote)) return false;

  return pushMasterAuthToGithub();
}

/** 로그인 화면 안내용 */
export async function getMasterAuthStatus() {
  const remote = await fetchRemoteMasterAuth();
  const local = await getMasterRecord();

  const registered = Boolean(
    remote?.passwordHash
    || (local?.passwordHash && !local?.mustChangePassword)
  );

  return {
    registered,
    mustChangePassword: remote
      ? !!remote.mustChangePassword
      : !!local?.mustChangePassword,
    remoteAvailable: !!remote,
    username: MASTER_USERNAME,
  };
}
