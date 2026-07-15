/** 사용자 인증 · 역할 · 세션
 *
 * SoT: GitHub data/workspace/auth/users.json
 * 캐시: IndexedDB `users` (브라우저 로컬)
 * - 로그인: 로컬 조회 → 없으면 GitHub pull → 재조회
 * - 가입·비번·역할: 로컬 저장 후 GitHub push
 */

import * as storage from './storage.js';
import {
  syncUsersFromGithub,
  tryPushUsersToGithub,
  ensureUsersPublished,
  fetchRemoteAuthCatalog,
  applyRemoteUsers,
  refreshMergedUserCatalog,
} from './auth-sync.js';
import { nowIso, uuid } from './utils.js';
import { emit } from './events.js';

export const ROLES = {
  USER: 'user',
  NOVELIST: 'admin_novelist',
  DEVELOPER: 'admin_developer',
  MASTER: 'admin_master',
};

export const ROLE_LABELS = {
  [ROLES.USER]: '사용자',
  [ROLES.NOVELIST]: '소설가',
  [ROLES.DEVELOPER]: '개발자',
  [ROLES.MASTER]: '마스터관리자',
};

export const MAX_USER_PROJECTS = 3;
export const MASTER_USERNAME = 'master';
const SESSION_KEY = 'ne-auth-session';
/** 클라이언트 앱 페퍼 — 로컬 DB 평문 노출 완화용(서버 비밀키 수준은 아님) */
const APP_PEPPER = 'NovelExplor/auth/v1/id-pepper';

let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

export function isLoggedIn() {
  return !!currentUser;
}

/** 일반 사용자는 파일 업로드 기능 사용 불가 (역할만 확인) */
export function canUpload(user = currentUser) {
  if (!user) return false;
  return user.role !== ROLES.USER;
}

export function isMaster(user = currentUser) {
  return user?.role === ROLES.MASTER;
}

/** writers 배열 정규화 */
export function normalizeWriters(writers) {
  if (!Array.isArray(writers)) return [];
  return [...new Set(writers.map((id) => String(id || '').trim()).filter(Boolean))];
}

/** writerUsernames 정규화 (소문자) */
export function normalizeWriterNames(names) {
  if (!Array.isArray(names)) return [];
  return [...new Set(names.map((n) => String(n || '').trim().toLowerCase()).filter(Boolean))];
}

/** 쓰기 권한 부여 대상(소설가·개발자). 마스터는 항상 쓰기 가능하므로 목록에서 제외 */
export function canBeProjectWriter(user) {
  if (!user) return false;
  return user.role === ROLES.NOVELIST || user.role === ROLES.DEVELOPER;
}

/**
 * 프로젝트 콘텐츠 관리(파일·소설·인물·관계도 등) 가능 여부
 * - 마스터: 모든 프로젝트
 * - 개발자·소설가: writers(userId) 또는 writerUsernames 에 포함된 경우
 * - ACL 없으면 ownerId 일치 시 허용
 * - 일반 사용자: 불가(열람만)
 */
export function canManageProjectContent(project, user = currentUser) {
  if (!user || user.role === ROLES.USER) return false;
  if (!project) return false;
  if (user.role === ROLES.MASTER) return true;

  const writers = normalizeWriters(project.writers);
  const writerNames = normalizeWriterNames(project.writerUsernames);
  const uname = String(user.username || '').trim().toLowerCase();

  if (writers.includes(user.id)) return true;
  if (uname && writerNames.includes(uname)) return true;

  if (writers.length || writerNames.length) return false;

  return Boolean(project.ownerId && project.ownerId === user.id);
}

export function canSaveProject(user = currentUser) {
  return canUpload(user);
}

export function canSetDefaultProject(user = currentUser) {
  return user?.role === ROLES.MASTER;
}

export function canOpenProject(user = currentUser) {
  return !!user;
}

export function canManageRoles(user = currentUser) {
  return user?.role === ROLES.MASTER;
}

export function canCreateUnlimitedProjects(user = currentUser) {
  return user && user.role !== ROLES.USER;
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

/** localStorage에 세션 키가 있는지 (검증 전·빠른 게이트용) */
export function hasStoredSession() {
  const session = readSession();
  return !!(session && session.userId);
}

/**
 * 앱 시작: 로컬 세션 우선 복구 → GitHub 사용자 목록 → 마스터 부트스트랩
 * IndexedDB가 비었는데 세션만 남은 경우 → 세션 폐기 후 미로그인
 */
export async function initAuth() {
  // 1) 로컬 세션이 유효하면 네트워크 전에 즉시 복구 (로그인 UX)
  const earlySession = readSession();
  if (earlySession?.userId) {
    const localUser = await storage.get('users', earlySession.userId);
    if (localUser && !localUser.disabled) {
      currentUser = await toPublicUser(localUser);
      emit('auth:changed', currentUser);
    }
  }

  try {
    await syncUsersFromGithub();
  } catch (err) {
    console.warn('[auth] GitHub 사용자 동기화 실패:', err);
  }

  await ensureMasterAccount();
  await migrateAllUsers();

  try {
    // 로컬에만 있는 계정(가입분)을 GitHub에 올림
    await ensureUsersPublished();
  } catch (err) {
    console.warn('[auth] 사용자 GitHub 게시 실패:', err);
  }

  // 동기화 중 로그인한 경우 덮어쓰지 않음
  if (currentUser) {
    const still = await storage.get('users', currentUser.id);
    if (still && !still.disabled) return currentUser;
    currentUser = null;
    clearSession();
  }

  const session = readSession();
  if (session?.userId) {
    let user = await storage.get('users', session.userId);
    if (!user) {
      try {
        await syncUsersFromGithub();
        user = await storage.get('users', session.userId);
      } catch {
        /* ignore */
      }
    }
    if (user && !user.disabled) {
      currentUser = await toPublicUser(user);
      emit('auth:changed', currentUser);
      return currentUser;
    }
    // 브라우저 데이터가 날아가 사용자 레코드가 없으면 세션도 폐기
    clearSession();
  }
  currentUser = null;
  emit('auth:changed', null);
  return null;
}

/**
 * 마스터 보장 — GitHub에 이미 계정이 있으면 로컬 초기 master/master 생성하지 않음
 */
async function ensureMasterAccount() {
  const users = await storage.getAll('users');
  let master = users.find((u) => u.role === ROLES.MASTER);
  if (!master) {
    const masterHash = await hashUsername(MASTER_USERNAME);
    master = users.find((u) => u.usernameHash === masterHash || u.username === MASTER_USERNAME);
  }
  if (master) {
    await migrateUserRecord(master);
    return master;
  }

  // GitHub에 사용자(마스터)가 있으면 로컬 부트스트랩 금지 — pull 재시도
  const remote = await fetchRemoteAuthCatalog();
  if (remote?.users?.length) {
    await applyRemoteUsers(remote);
    const after = await storage.getAll('users');
    master = after.find((u) => u.role === ROLES.MASTER);
    if (master) return master;
    throw new Error('GitHub에 사용자 정보가 있으나 마스터 계정을 찾을 수 없습니다.');
  }

  // 최초 1대: 로컬에만 초기 마스터 생성 (이후 비번 변경·PAT로 GitHub 게시)
  const salt = uuid().replace(/-/g, '').slice(0, 16);
  const passwordHash = await hashPassword('master', salt);
  const usernameHash = await hashUsername(MASTER_USERNAME);
  const usernameEnc = await encryptUsername(MASTER_USERNAME, salt);
  const record = {
    id: 'user-master',
    usernameHash,
    usernameEnc,
    passwordHash,
    salt,
    role: ROLES.MASTER,
    mustChangePassword: true,
    disabled: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await storage.put('users', record);
  return record;
}

async function migrateAllUsers() {
  const users = await storage.getAll('users');
  for (const u of users) {
    await migrateUserRecord(u);
  }
}

async function migrateUserRecord(user) {
  if (!user) return user;
  let changed = false;

  if (user.username && (!user.usernameHash || !user.usernameEnc)) {
    const salt = user.salt || uuid().replace(/-/g, '').slice(0, 16);
    if (!user.salt) {
      user.salt = salt;
      changed = true;
    }
    user.usernameHash = await hashUsername(user.username);
    user.usernameEnc = await encryptUsername(String(user.username).toLowerCase(), salt);
    changed = true;
  }

  if (user.username != null) {
    delete user.username;
    changed = true;
  }

  if (changed) {
    user.updatedAt = nowIso();
    await storage.put('users', user);
  }
  return user;
}

export async function signup(username, password) {
  const id = String(username || '').trim().toLowerCase();
  const pw = String(password || '');
  if (!/^[a-z0-9_]{3,32}$/.test(id)) {
    throw new Error('아이디는 영문 소문자·숫자·밑줄 3~32자여야 합니다.');
  }
  if (pw.length < 4) {
    throw new Error('비밀번호는 4자 이상이어야 합니다.');
  }
  if (id === MASTER_USERNAME) {
    throw new Error('이 아이디는 사용할 수 없습니다.');
  }

  await syncUsersFromGithub().catch(() => {});

  const existing = await findUserByUsername(id);
  if (existing) throw new Error('이미 사용 중인 아이디입니다.');

  const salt = uuid().replace(/-/g, '').slice(0, 16);
  const passwordHash = await hashPassword(pw, salt);
  const usernameHash = await hashUsername(id);
  const usernameEnc = await encryptUsername(id, salt);
  const record = {
    id: `user-${uuid()}`,
    usernameHash,
    usernameEnc,
    passwordHash,
    salt,
    role: ROLES.USER,
    mustChangePassword: false,
    disabled: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await storage.put('users', record);
  // 로컬 가입 성공이 본업. GitHub 커밋은 별도 시도(실패해도 가입 유지)
  const github = await tryPushUsersToGithub();
  return { user: await toPublicUser(record), github };
}

/**
 * 로그인: 로컬 비밀번호 먼저 검증(네트워크에 막히지 않음)
 * → 실패/계정 없을 때만 GitHub pull 후 재시도
 */
export async function login(username, password) {
  const id = String(username || '').trim().toLowerCase();
  const pw = String(password || '');

  let user = await findUserByUsername(id);

  // 로컬에 계정이 있으면 즉시 검증 — GitHub 대기로 버튼이 멈추지 않게
  if (user && !user.disabled) {
    const ok = await verifyPassword(pw, user.salt, user.passwordHash);
    if (ok) {
      currentUser = await toPublicUser(user);
      writeSession(currentUser);
      emit('auth:changed', currentUser);
      syncUsersFromGithub().catch(() => {});
      return currentUser;
    }
  }

  try {
    await syncUsersFromGithub();
  } catch (err) {
    console.warn('[auth] 로그인 전 GitHub pull 실패:', err);
  }
  user = await findUserByUsername(id);

  if (!user || user.disabled) {
    throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  const ok = await verifyPassword(pw, user.salt, user.passwordHash);
  if (!ok) {
    throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  currentUser = await toPublicUser(user);
  writeSession(currentUser);
  emit('auth:changed', currentUser);
  return currentUser;
}

export async function loginMaster(password) {
  return login(MASTER_USERNAME, password);
}

export function logout() {
  currentUser = null;
  clearSession();
  emit('auth:changed', null);
}

export async function changePassword(currentPassword, newPassword) {
  if (!currentUser) throw new Error('로그인이 필요합니다.');
  if (String(newPassword || '').length < 4) {
    throw new Error('새 비밀번호는 4자 이상이어야 합니다.');
  }

  const user = await storage.get('users', currentUser.id);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');

  const ok = await verifyPassword(currentPassword, user.salt, user.passwordHash);
  if (!ok) throw new Error('현재 비밀번호가 올바르지 않습니다.');

  const plainId = await decryptUsername(user.usernameEnc, user.salt);
  const salt = uuid().replace(/-/g, '').slice(0, 16);
  user.passwordHash = await hashPassword(newPassword, salt);
  user.salt = salt;
  user.usernameEnc = await encryptUsername(plainId, salt);
  user.mustChangePassword = false;
  user.updatedAt = nowIso();
  await storage.put('users', user);
  currentUser = await toPublicUser(user);
  writeSession(currentUser);
  emit('auth:changed', currentUser);

  // 로컬 변경이 본업. GitHub 커밋은 별도 시도
  const github = await tryPushUsersToGithub();
  return { user: currentUser, github };
}

export async function listUsers() {
  // 1) 로컬 2) GitHub 병합 3) 로컬이 더 많으면 GitHub 게시
  try {
    await refreshMergedUserCatalog();
  } catch (err) {
    console.warn('[auth] 사용자 목록 병합 실패:', err);
  }
  const users = await storage.getAll('users');
  const out = [];
  for (const u of users) {
    out.push(await toPublicUser(u));
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

export async function setUserRole(userId, role) {
  if (!canManageRoles()) throw new Error('마스터관리자만 권한을 변경할 수 있습니다.');
  if (!Object.values(ROLES).includes(role)) throw new Error('잘못된 역할입니다.');

  const user = await storage.get('users', userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');

  if (user.id === currentUser.id && role !== ROLES.MASTER) {
    throw new Error('자신의 마스터 권한은 해제할 수 없습니다.');
  }

  if (user.role === ROLES.MASTER && role !== ROLES.MASTER) {
    const masters = (await storage.getAll('users')).filter((u) => u.role === ROLES.MASTER);
    if (masters.length <= 1) throw new Error('마스터관리자는 최소 1명 필요합니다.');
  }

  user.role = role;
  user.updatedAt = nowIso();
  await storage.put('users', user);

  const github = await tryPushUsersToGithub();

  if (user.id === currentUser.id) {
    currentUser = await toPublicUser(user);
    writeSession(currentUser);
    emit('auth:changed', currentUser);
  }
  return { user: await toPublicUser(user), github };
}

async function findUserByUsername(username) {
  const hash = await hashUsername(String(username || '').trim().toLowerCase());
  const users = await storage.getAll('users');
  return users.find((u) => u.usernameHash === hash
    || u.username === String(username || '').trim().toLowerCase()) || null;
}

async function toPublicUser(user) {
  let username = '';
  try {
    if (user.usernameEnc && user.salt) {
      username = await decryptUsername(user.usernameEnc, user.salt);
    } else if (user.username) {
      username = user.username;
    }
  } catch {
    username = '(복호화 실패)';
  }
  return {
    id: user.id,
    username,
    role: user.role,
    mustChangePassword: !!user.mustChangePassword,
    createdAt: user.createdAt,
  };
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: user.id,
    role: user.role,
    loginAt: nowIso(),
  }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function hashUsername(username) {
  const enc = new TextEncoder();
  const data = enc.encode(`${APP_PEPPER}|id|${String(username).trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64(digest);
}

async function deriveUsernameKey(salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(APP_PEPPER),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(`id-aes|${salt}`),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptUsername(plain, salt) {
  const key = await deriveUsernameKey(salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(String(plain).toLowerCase())
  );
  return `${bufferToBase64(iv)}.${bufferToBase64(cipher)}`;
}

async function decryptUsername(payload, salt) {
  const [ivB64, dataB64] = String(payload || '').split('.');
  if (!ivB64 || !dataB64) throw new Error('invalid username cipher');
  const key = await deriveUsernameKey(salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBuffer(ivB64) },
    key,
    base64ToBuffer(dataB64)
  );
  return new TextDecoder().decode(plainBuf);
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(String(salt)),
      iterations: 120000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bufferToBase64(bits);
}

async function verifyPassword(password, salt, expectedHash) {
  const hash = await hashPassword(password, salt);
  return hash === expectedHash;
}

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
