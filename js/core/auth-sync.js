/** 사용자·관리자 인증 — GitHub SoT, IndexedDB는 브라우저 캐시
 *
 * 저장: data/workspace/auth/users.json
 * 흐름: 로그인 시 로컬 조회 → 없으면 GitHub pull → 다시 조회
 * 변경(가입·비번·역할): 로컬 저장 후 GitHub push (PAT 필요)
 */

import * as storage from './storage.js';
import { putRepoFile } from './github-api.js';
import { getGithubConfig, hasGithubToken, rawGithubUrl } from './github-config.js';
import { nowIso } from './utils.js';

const USERS_FORMAT = 'novel-explor-users/v1';
const MASTER_ROLE = 'admin_master';
export const MASTER_USERNAME = 'master';

export function usersAuthPath(cfg = getGithubConfig()) {
  return `${cfg.workspaceRoot}/auth/users.json`;
}

/** 하위 호환: 예전 master-auth.json */
export function masterAuthPath(cfg = getGithubConfig()) {
  return `${cfg.workspaceRoot}/auth/master-auth.json`;
}

function toAuthRecord(u) {
  return {
    id: u.id,
    usernameHash: u.usernameHash,
    usernameEnc: u.usernameEnc,
    passwordHash: u.passwordHash,
    salt: u.salt,
    role: u.role,
    mustChangePassword: !!u.mustChangePassword,
    disabled: !!u.disabled,
    createdAt: u.createdAt || nowIso(),
    updatedAt: u.updatedAt || nowIso(),
  };
}

/** GitHub users.json (공개 raw, 토큰 불필요) */
export async function fetchRemoteUsers() {
  try {
    const url = rawGithubUrl(usersAuthPath());
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.users) || !data.users.length) return null;
    return data;
  } catch {
    return null;
  }
}

/** 예전 master-auth.json → users 형태로 변환 */
async function fetchLegacyMasterAsUsers() {
  try {
    const url = rawGithubUrl(masterAuthPath());
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const m = await res.json();
    if (!m?.passwordHash || !m?.salt) return null;
    return {
      format: USERS_FORMAT,
      updatedAt: m.updatedAt || nowIso(),
      users: [{
        id: 'user-master',
        usernameHash: m.usernameHash,
        usernameEnc: m.usernameEnc,
        passwordHash: m.passwordHash,
        salt: m.salt,
        role: MASTER_ROLE,
        mustChangePassword: !!m.mustChangePassword,
        disabled: false,
        createdAt: m.updatedAt || nowIso(),
        updatedAt: m.updatedAt || nowIso(),
      }],
    };
  } catch {
    return null;
  }
}

export async function fetchRemoteAuthCatalog() {
  return (await fetchRemoteUsers()) || (await fetchLegacyMasterAsUsers());
}

/** 원격 사용자 목록 → IndexedDB 전체 교체(캐시) */
export async function applyRemoteUsers(remote) {
  if (!remote?.users?.length) return false;

  const existing = await storage.getAll('users');
  const keepIds = new Set(remote.users.map((u) => u.id));

  for (const u of remote.users) {
    if (!u?.id || !u.passwordHash || !u.salt) continue;
    const record = toAuthRecord(u);
    delete record.username;
    await storage.put('users', record);
  }

  // GitHub에 없는 로컬 계정 제거 (SoT = GitHub)
  for (const local of existing) {
    if (!keepIds.has(local.id)) {
      await storage.remove('users', local.id);
    }
  }
  return true;
}

/**
 * GitHub → 로컬 (GitHub가 SoT — 원격이 있으면 항상 캐시에 반영)
 */
export async function syncUsersFromGithub({ force = true } = {}) {
  const remote = await fetchRemoteAuthCatalog();
  if (!remote?.users?.length) return false;

  // force=false 는 하위 호환용. SoT 정책상 원격이 있으면 적용.
  void force;
  return applyRemoteUsers(remote);
}

/** 로컬 전체 사용자 → GitHub */
export async function pushUsersToGithub() {
  if (!hasGithubToken()) {
    throw new Error('GitHub PAT가 필요합니다. 우측 패널에서 토큰을 저장하세요.');
  }

  const users = await storage.getAll('users');
  if (!users.length) return false;

  const payload = {
    format: USERS_FORMAT,
    updatedAt: nowIso(),
    users: users.map(toAuthRecord),
  };

  await putRepoFile(
    usersAuthPath(),
    JSON.stringify(payload, null, 2),
    'NovelExplor: users auth sync'
  );

  // 하위 호환: 마스터만 master-auth.json에도 기록
  const master = users.find((u) => u.role === MASTER_ROLE);
  if (master) {
    await putRepoFile(
      masterAuthPath(),
      JSON.stringify({
        format: 'master-auth/v1',
        usernameHash: master.usernameHash,
        usernameEnc: master.usernameEnc,
        passwordHash: master.passwordHash,
        salt: master.salt,
        mustChangePassword: !!master.mustChangePassword,
        updatedAt: master.updatedAt || nowIso(),
      }, null, 2),
      'NovelExplor: master auth sync'
    );
  }
  return true;
}

/** 원격 없고 로컬만 있으면(등록 완료 마스터 포함) GitHub에 게시 */
export async function ensureUsersPublished() {
  if (!hasGithubToken()) return false;

  const local = await storage.getAll('users');
  if (!local.length) return false;

  const remote = await fetchRemoteAuthCatalog();
  if (remote?.users?.length) {
    // 이미 원격 있음 — 해시/개수가 같으면 skip
    if (remote.users.length === local.length) {
      const same = remote.users.every((ru) => {
        const lu = local.find((u) => u.id === ru.id);
        return lu && lu.passwordHash === ru.passwordHash && lu.role === ru.role;
      });
      if (same) return false;
    }
  }

  try {
    return await pushUsersToGithub();
  } catch (err) {
    console.warn('[auth-sync] users publish 실패:', err);
    return false;
  }
}

/** 로그인 화면 상태 */
export async function getAuthCatalogStatus() {
  const remote = await fetchRemoteAuthCatalog();
  const local = await storage.getAll('users');
  const masterRemote = remote?.users?.find((u) => u.role === MASTER_ROLE);
  const masterLocal = local.find((u) => u.role === MASTER_ROLE);

  return {
    remoteAvailable: Boolean(remote?.users?.length),
    remoteUserCount: remote?.users?.length || 0,
    localUserCount: local.length,
    masterRegistered: Boolean(
      (masterRemote && !masterRemote.mustChangePassword)
      || (masterLocal && !masterLocal.mustChangePassword)
    ),
    mustChangePassword: masterRemote
      ? !!masterRemote.mustChangePassword
      : !!masterLocal?.mustChangePassword,
    username: MASTER_USERNAME,
  };
}

/* —— 하위 호환 export (기존 호출부) —— */

export async function syncMasterAuthFromGithub() {
  return syncUsersFromGithub({ force: true });
}

export async function pushMasterAuthToGithub() {
  return pushUsersToGithub();
}

export async function ensureMasterAuthPublished() {
  return ensureUsersPublished();
}

export async function getMasterAuthStatus() {
  return getAuthCatalogStatus();
}
