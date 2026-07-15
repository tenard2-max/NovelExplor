/** 사용자·관리자 인증 — GitHub + IndexedDB 병합
 *
 * 저장: data/workspace/auth/users.json
 * 목록: 로컬 조회 → GitHub pull → 병합(합집합) 표시
 * 변경(가입·비번·역할): 로컬 저장 후 GitHub push (전체 계정)
 * ※ GitHub에 없는 로컬 계정을 삭제하지 않음 (이전 SoT 교체 버그 수정)
 */

import * as storage from './storage.js';
import { commitRepoFiles } from './github-api.js';
import { getGithubConfig, hasGithubToken, rawGithubUrl } from './github-config.js';
import { nowIso } from './utils.js';

const USERS_FORMAT = 'novel-explor-users/v1';
const MASTER_ROLE = 'admin_master';
export const MASTER_USERNAME = 'master';

export function usersAuthPath(cfg = getGithubConfig()) {
  return `${cfg.workspaceRoot}/auth/users.json`;
}

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

function ts(u) {
  return Date.parse(u?.updatedAt || 0) || 0;
}

/** 로컬 ∪ 원격 — 동일 id면 최신 updatedAt 우선 */
export function mergeUserRecords(localUsers = [], remoteUsers = []) {
  const map = new Map();
  for (const u of localUsers) {
    if (!u?.id) continue;
    map.set(u.id, toAuthRecord(u));
  }
  for (const u of remoteUsers) {
    if (!u?.id || !u.passwordHash || !u.salt) continue;
    const next = toAuthRecord(u);
    const prev = map.get(u.id);
    if (!prev || ts(next) >= ts(prev)) map.set(u.id, next);
  }
  return dedupeByUsernameHash([...map.values()]);
}

/**
 * 동일 usernameHash(같은 아이디)는 1명만 유지 — 최신 updatedAt 우선
 * @param {object[]} users
 * @param {{ preferId?: string }} [opts]
 */
export function dedupeByUsernameHash(users = [], opts = {}) {
  const preferId = opts.preferId || '';
  const byHash = new Map();
  const noHash = [];

  for (const u of users) {
    if (!u?.id) continue;
    const rec = toAuthRecord(u);
    if (!rec.usernameHash) {
      noHash.push(rec);
      continue;
    }
    const prev = byHash.get(rec.usernameHash);
    if (!prev) {
      byHash.set(rec.usernameHash, rec);
      continue;
    }
    if (preferId && rec.id === preferId) {
      byHash.set(rec.usernameHash, rec);
      continue;
    }
    if (preferId && prev.id === preferId) continue;
    if (ts(rec) >= ts(prev)) byHash.set(rec.usernameHash, rec);
  }

  return [...byHash.values(), ...noHash];
}

/**
 * IndexedDB에서 중복 아이디 레코드 제거
 * @returns {Promise<{ kept: number, removed: number }>}
 */
export async function pruneDuplicateUsers(preferId = '') {
  const all = await storage.getAll('users');
  const kept = dedupeByUsernameHash(all, { preferId });
  const keptIds = new Set(kept.map((u) => u.id));
  let removed = 0;
  for (const u of all) {
    if (!u?.id || keptIds.has(u.id)) continue;
    await storage.remove('users', u.id);
    removed += 1;
  }
  for (const rec of kept) {
    delete rec.username;
    await storage.put('users', rec);
  }
  return { kept: kept.length, removed };
}

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

/**
 * 원격 → 로컬 병합(upsert). 로컬 전용 계정은 삭제하지 않음.
 * @returns {Promise<number>} 병합 후 로컬 계정 수
 */
export async function applyRemoteUsers(remote) {
  const remoteList = remote?.users || [];
  const local = await storage.getAll('users');
  const merged = mergeUserRecords(local, remoteList);
  const keptIds = new Set(merged.map((u) => u.id));

  for (const record of merged) {
    delete record.username;
    await storage.put('users', record);
  }
  // 동일 아이디의 구 레코드 제거 (id만 다른 중복)
  for (const u of local) {
    if (u?.id && !keptIds.has(u.id)) {
      const stillDup = merged.some((m) => m.usernameHash && m.usernameHash === u.usernameHash);
      if (stillDup) await storage.remove('users', u.id);
    }
  }
  return merged.length;
}

/**
 * GitHub pull 후 로컬과 병합
 * @returns {Promise<{ merged: number, remoteCount: number, localOnly: number } | false>}
 */
export async function syncUsersFromGithub() {
  const remote = await fetchRemoteAuthCatalog();
  const remoteCount = remote?.users?.length || 0;
  if (!remoteCount) return false;

  const before = await storage.getAll('users');
  const merged = await applyRemoteUsers(remote);
  const after = await storage.getAll('users');
  const remoteIds = new Set((remote.users || []).map((u) => u.id));
  const localOnly = after.filter((u) => !remoteIds.has(u.id)).length;

  return {
    merged,
    remoteCount,
    localBefore: before.length,
    localOnly,
  };
}

/**
 * 로컬 전체 → GitHub Trees 1커밋.
 * 성공/실패만 의미함. 인원수 재검증 없음.
 * (업무 흐름에서 직접 throw로 막지 말고 tryPushUsersToGithub 사용)
 */
export async function pushUsersToGithub() {
  if (!hasGithubToken()) {
    throw new Error('GitHub PAT가 필요합니다. 우측 패널 GitHub에서 토큰(repo 권한)을 저장하세요.');
  }

  const users = await storage.getAll('users');
  if (!users.length) throw new Error('게시할 사용자 계정이 없습니다.');

  const updatedAt = nowIso();
  const payload = {
    format: USERS_FORMAT,
    updatedAt,
    users: users.map(toAuthRecord),
  };

  const files = [{
    repoPath: usersAuthPath(),
    content: JSON.stringify(payload, null, 2),
  }];

  const master = users.find((u) => u.role === MASTER_ROLE);
  if (master) {
    files.push({
      repoPath: masterAuthPath(),
      content: JSON.stringify({
        format: 'master-auth/v1',
        usernameHash: master.usernameHash,
        usernameEnc: master.usernameEnc,
        passwordHash: master.passwordHash,
        salt: master.salt,
        mustChangePassword: !!master.mustChangePassword,
        updatedAt: master.updatedAt || updatedAt,
      }, null, 2),
    });
  }

  // commitRepoFiles 성공 = 커밋 성공 (여기까지만 확인)
  await commitRepoFiles(files, `NovelExplor: auth users sync (${users.length})`);
  return { userCount: users.length, updatedAt, committed: true };
}

/**
 * 로컬 저장 후 GitHub 게시는 별도 시도.
 * 커밋 성공/실패는 반환값에만 담고, 호출부 업무(가입·비번·등급·목록)를 막지 않음.
 * @returns {Promise<{ ok: boolean, userCount?: number, skipped?: boolean, error?: string, committed?: boolean }>}
 */
export async function tryPushUsersToGithub() {
  if (!hasGithubToken()) {
    return { ok: false, skipped: true, error: 'PAT 없음 — 로컬만 저장됨' };
  }
  try {
    const result = await pushUsersToGithub();
    return {
      ok: true,
      committed: true,
      userCount: result.userCount,
      updatedAt: result.updatedAt,
    };
  } catch (err) {
    console.warn('[auth-sync] GitHub 게시 실패(업무는 계속):', err);
    return { ok: false, committed: false, error: err?.message || String(err) };
  }
}

/**
 * 로컬에만 있는 계정이 있으면 GitHub에 전체 게시
 * (마스터 포함 N명 등록 후 원격이 1명만인 경우 복구)
 */
export async function ensureUsersPublished() {
  if (!hasGithubToken()) return false;

  const local = await storage.getAll('users');
  if (!local.length) return false;

  const remote = await fetchRemoteAuthCatalog();
  const remoteUsers = remote?.users || [];

  const needsPush = local.length !== remoteUsers.length
    || local.some((lu) => {
      const ru = remoteUsers.find((u) => u.id === lu.id);
      if (!ru) return true;
      return ru.passwordHash !== lu.passwordHash || ru.role !== lu.role;
    });

  if (!needsPush) return false;

  const result = await tryPushUsersToGithub();
  return result.ok ? result : false;
}

/**
 * 목록용: 로컬 → GitHub 병합 → (로컬이 더 많으면) 게시
 */
export async function refreshMergedUserCatalog() {
  const localFirst = await storage.getAll('users');
  try {
    await syncUsersFromGithub();
  } catch (err) {
    console.warn('[auth-sync] GitHub 병합 실패:', err);
  }

  await pruneDuplicateUsers();

  const merged = await storage.getAll('users');
  let published = null;
  if (hasGithubToken()) {
    const remote = await fetchRemoteAuthCatalog();
    const remoteCount = remote?.users?.length || 0;
    if (merged.length !== remoteCount) {
      published = await tryPushUsersToGithub();
    }
  }

  return {
    localFirst: localFirst.length,
    merged: merged.length,
    published,
  };
}

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

export async function syncMasterAuthFromGithub() {
  return syncUsersFromGithub();
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
