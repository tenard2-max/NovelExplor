/** 사용자 인증 · 역할 · 세션
 *
 * 저장소: IndexedDB `users` 스토어 (브라우저 로컬 DB)
 * - 아이디: SHA-256 조회 해시 + AES-GCM 암호문 (평문 미저장)
 * - 비밀번호: PBKDF2(SHA-256, 120000회) + salt 해시
 */

import * as storage from './storage.js';
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

/** 일반 사용자는 파일 업로드 기능 사용 불가 */
export function canUpload(user = currentUser) {
  if (!user) return false;
  return user.role !== ROLES.USER;
}

/** 관리자(마스터·개발자·소설가)만 프로젝트 저장·생성 가능. 일반 사용자는 열기만 */
export function canSaveProject(user = currentUser) {
  return canUpload(user);
}

/** 마스터만 기본 프로젝트 지정 가능 */
export function canSetDefaultProject(user = currentUser) {
  return user?.role === ROLES.MASTER;
}

/** 로그인한 사용자는 프로젝트 열기 가능 */
export function canOpenProject(user = currentUser) {
  return !!user;
}

/** 마스터만 사용자/관리자 권한 변경 */
export function canManageRoles(user = currentUser) {
  return user?.role === ROLES.MASTER;
}

export function canCreateUnlimitedProjects(user = currentUser) {
  return user && user.role !== ROLES.USER;
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

/** 앱 시작 시 마스터 계정 보장 + 세션 복원 */
export async function initAuth() {
  await ensureMasterAccount();
  await migrateAllUsers();

  const session = readSession();
  if (session?.userId) {
    const user = await storage.get('users', session.userId);
    if (user && !user.disabled) {
      currentUser = await toPublicUser(user);
      emit('auth:changed', currentUser);
      return currentUser;
    }
    clearSession();
  }
  currentUser = null;
  emit('auth:changed', null);
  return null;
}

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

/** 구버전 평문 username → 해시+암호문 */
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
  return toPublicUser(record);
}

export async function login(username, password) {
  const id = String(username || '').trim().toLowerCase();
  const user = await findUserByUsername(id);
  if (!user || user.disabled) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');

  const ok = await verifyPassword(password, user.salt, user.passwordHash);
  if (!ok) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');

  currentUser = await toPublicUser(user);
  writeSession(currentUser);
  emit('auth:changed', currentUser);
  return currentUser;
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

  // salt 변경 시 아이디 암호문도 재암호화
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
  return currentUser;
}

export async function listUsers() {
  const users = await storage.getAll('users');
  const out = [];
  for (const u of users) {
    out.push(await toPublicUser(u));
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

/** 마스터만: 역할 변경 */
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

  if (user.id === currentUser.id) {
    currentUser = await toPublicUser(user);
    writeSession(currentUser);
    emit('auth:changed', currentUser);
  }
  return toPublicUser(user);
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
  // 세션에는 userId·역할만 — 아이디 평문은 메모리(currentUser)에만
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: user.id,
    role: user.role,
    loginAt: nowIso(),
  }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/** 아이디 조회용 결정적 해시 (DB에 평문 아이디 없음) */
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
