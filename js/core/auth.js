/** 사용자 인증 · 역할 · 세션 */

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
  const session = readSession();
  if (session?.userId) {
    const user = await storage.get('users', session.userId);
    if (user && !user.disabled) {
      currentUser = publicUser(user);
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
  const master = users.find((u) => u.role === ROLES.MASTER || u.username === MASTER_USERNAME);
  if (master) return master;

  const salt = uuid().replace(/-/g, '').slice(0, 16);
  const passwordHash = await hashPassword('master', salt);
  const record = {
    id: 'user-master',
    username: MASTER_USERNAME,
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
  const record = {
    id: `user-${uuid()}`,
    username: id,
    passwordHash,
    salt,
    role: ROLES.USER,
    mustChangePassword: false,
    disabled: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await storage.put('users', record);
  return publicUser(record);
}

export async function login(username, password) {
  const id = String(username || '').trim().toLowerCase();
  const user = await findUserByUsername(id);
  if (!user || user.disabled) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');

  const ok = await verifyPassword(password, user.salt, user.passwordHash);
  if (!ok) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');

  currentUser = publicUser(user);
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

  const salt = uuid().replace(/-/g, '').slice(0, 16);
  user.passwordHash = await hashPassword(newPassword, salt);
  user.salt = salt;
  user.mustChangePassword = false;
  user.updatedAt = nowIso();
  await storage.put('users', user);
  currentUser = publicUser(user);
  writeSession(currentUser);
  emit('auth:changed', currentUser);
  return currentUser;
}

export async function listUsers() {
  const users = await storage.getAll('users');
  return users.map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
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
    currentUser = publicUser(user);
    writeSession(currentUser);
    emit('auth:changed', currentUser);
  }
  return publicUser(user);
}

async function findUserByUsername(username) {
  const users = await storage.getAll('users');
  return users.find((u) => u.username === username) || null;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
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
    username: user.username,
    role: user.role,
    loginAt: nowIso(),
  }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
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
