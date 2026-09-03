import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const AUTH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  result TEXT NOT NULL,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id, created_at DESC);
`;

const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_N = 16_384;
const PASSWORD_R = 8;
const PASSWORD_P = 1;
const PASSWORD_KEYLEN = 64;

function now() {
  return new Date();
}

function iso(date = now()) {
  return date.toISOString();
}

function addMs(date, milliseconds) {
  return new Date(date.getTime() + milliseconds);
}

function normalizeUsername(value) {
  const username = String(value ?? "").trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    const error = new Error("用户名须为 3-64 位字母、数字、点、下划线或短横线");
    error.code = "VALIDATION_ERROR";
    error.status = 400;
    throw error;
  }
  return username;
}

function normalizeDisplayName(value, fallback) {
  const displayName = String(value ?? fallback ?? "").trim();
  if (displayName.length < 1 || displayName.length > 100) {
    const error = new Error("显示名称须为 1-100 个字符");
    error.code = "VALIDATION_ERROR";
    error.status = 400;
    throw error;
  }
  return displayName;
}

function normalizeRole(value = "viewer") {
  if (!["admin", "viewer"].includes(value)) {
    const error = new Error("角色必须是 admin 或 viewer");
    error.code = "VALIDATION_ERROR";
    error.status = 400;
    throw error;
  }
  return value;
}

function normalizeActive(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const error = new Error("账号状态必须是布尔值");
  error.code = "VALIDATION_ERROR";
  error.status = 400;
  throw error;
}

function normalizePassword(value) {
  const password = String(value ?? "");
  if (password.length < 12 || password.length > 200) {
    const error = new Error("密码须为 12-200 个字符");
    error.code = "VALIDATION_ERROR";
    error.status = 400;
    throw error;
  }
  return password;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, PASSWORD_KEYLEN, {
    N: PASSWORD_N,
    r: PASSWORD_R,
    p: PASSWORD_P,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$${PASSWORD_N}$${PASSWORD_R}$${PASSWORD_P}$${salt}$${Buffer.from(derived).toString("base64url")}`;
}

async function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expectedEncoded] = parts;
  const N = Number(n); const R = Number(r); const P = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P) || !salt || !expectedEncoded) return false;
  try {
    const expected = Buffer.from(expectedEncoded, "base64url");
    const actual = Buffer.from(await scrypt(String(password ?? ""), salt, expected.length, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header = "") {
  return Object.fromEntries(String(header).split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return [part, ""];
    try { return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]; } catch { return [part.slice(0, index), ""]; }
  }));
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    is_active: Boolean(row.is_active),
    must_change_password: Boolean(row.must_change_password),
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function authError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

export function migrateAuthSchema(database) {
  database.exec(AUTH_SCHEMA_SQL);
  return {
    tables: ["users", "sessions", "audit_log"],
    indexes: ["idx_sessions_token_hash", "idx_sessions_expires_at", "idx_audit_log_created_at", "idx_audit_log_user_id"]
  };
}

export function createAuthService(database, options = {}) {
  const cookieName = options.cookieName || "session";
  const failedAttempts = new Map();
  let dummyPasswordHashPromise;

  function dummyPasswordHash() {
    dummyPasswordHashPromise ||= hashPassword("invalid-login-dummy-password");
    return dummyPasswordHashPromise;
  }

  function listUsers() {
    return database.prepare("SELECT id,username,display_name,role,is_active,must_change_password,last_login_at,created_at,updated_at FROM users ORDER BY username").all().map(publicUser);
  }

  function activeAdminCount() {
    return database.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND is_active=1").get().count;
  }

  function userCount() {
    return database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  }

  function createUserRecord({ username, display_name, password_hash, role, is_active = 1, must_change_password = 0 }) {
    const timestamp = iso();
    try {
      const result = database.prepare(`INSERT INTO users(username,display_name,password_hash,role,is_active,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(username, display_name, password_hash, role, is_active ? 1 : 0, must_change_password ? 1 : 0, timestamp, timestamp);
      return database.prepare("SELECT * FROM users WHERE id=?").get(Number(result.lastInsertRowid));
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed: users.username")) throw authError(409, "USERNAME_TAKEN", "用户名已存在");
      throw error;
    }
  }

  async function bootstrapFromEnv(env = process.env) {
    if (activeAdminCount() > 0) return { created: false, reason: "already_initialized" };
    if (!env.AUTH_BOOTSTRAP_USERNAME || !env.AUTH_BOOTSTRAP_PASSWORD) return { created: false, reason: "credentials_missing" };
    const username = normalizeUsername(env.AUTH_BOOTSTRAP_USERNAME);
    const password = normalizePassword(env.AUTH_BOOTSTRAP_PASSWORD);
    const displayName = normalizeDisplayName(env.AUTH_BOOTSTRAP_DISPLAY_NAME, username);
    const user = createUserRecord({ username, display_name: displayName, password_hash: await hashPassword(password), role: "admin", must_change_password: 1 });
    return { created: true, user: publicUser(user) };
  }

  function userFromSessionToken(token) {
    if (!token) return null;
    const row = database.prepare(`SELECT s.*,u.username,u.display_name,u.role,u.is_active,u.must_change_password,u.last_login_at,u.created_at AS user_created_at,u.updated_at AS user_updated_at
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(hashToken(token));
    if (!row || !row.is_active) return null;
    const current = now();
    const idleExpired = new Date(row.expires_at).getTime() <= current.getTime();
    const absoluteExpired = new Date(row.created_at).getTime() + SESSION_ABSOLUTE_MS <= current.getTime();
    if (idleExpired || absoluteExpired) {
      database.prepare("DELETE FROM sessions WHERE id=?").run(row.id);
      return null;
    }
    const lastSeen = iso(current);
    const idleExpiry = iso(addMs(current, SESSION_IDLE_MS));
    database.prepare("UPDATE sessions SET last_seen_at=?,expires_at=? WHERE id=?").run(lastSeen, idleExpiry, row.id);
    return {
      user: publicUser({
        id: row.user_id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        is_active: row.is_active,
        must_change_password: row.must_change_password,
        last_login_at: row.last_login_at,
        created_at: row.user_created_at,
        updated_at: row.user_updated_at
      }),
      sessionId: row.id,
      token
    };
  }

  function authenticate(request) {
    const token = parseCookies(request.headers.cookie || "")[cookieName];
    return userFromSessionToken(token);
  }

  async function login({ username, password }, requestMeta = {}) {
    const normalized = normalizeUsername(username);
    const key = `${requestMeta.ip || "unknown"}:${normalized}`;
    const attempts = failedAttempts.get(key) || { count: 0, resetAt: 0 };
    if (attempts.resetAt > Date.now() && attempts.count >= 5) throw authError(429, "LOGIN_RATE_LIMITED", "登录尝试过于频繁，请稍后再试");
    if (attempts.resetAt <= Date.now()) attempts.count = 0;
    const row = database.prepare("SELECT * FROM users WHERE username=?").get(normalized);
    const passwordHash = row?.password_hash || await dummyPasswordHash();
    const valid = Boolean(row && row.is_active && await verifyPassword(password, passwordHash));
    if (!valid) {
      attempts.count += 1; attempts.resetAt = Date.now() + 5 * 60 * 1000; failedAttempts.set(key, attempts);
      throw authError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }
    failedAttempts.delete(key);
    const timestamp = iso();
    const token = randomBytes(32).toString("base64url");
    database.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at,ip_address,user_agent,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(hashToken(token), row.id, iso(addMs(now(), SESSION_IDLE_MS)), timestamp, requestMeta.ip || null, requestMeta.userAgent || null, timestamp);
    database.prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?").run(timestamp, timestamp, row.id);
    return { token, user: publicUser({ ...row, last_login_at: timestamp, updated_at: timestamp }), expires_at: iso(addMs(now(), SESSION_IDLE_MS)) };
  }

  function logout(token) {
    if (token) database.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));
  }

  async function createUser(payload) {
    const username = normalizeUsername(payload.username);
    const displayName = normalizeDisplayName(payload.display_name, username);
    const role = normalizeRole(payload.role);
    const password = normalizePassword(payload.password ?? payload.temporary_password);
    return publicUser(createUserRecord({ username, display_name: displayName, password_hash: await hashPassword(password), role, is_active: payload.is_active !== false, must_change_password: true }));
  }

  async function updateUser(userId, payload, actorUserId) {
    const id = Number(userId);
    const existing = database.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!existing) throw authError(404, "USER_NOT_FOUND", "用户不存在");
    const role = payload.role === undefined ? existing.role : normalizeRole(payload.role);
    const displayName = payload.display_name === undefined ? existing.display_name : normalizeDisplayName(payload.display_name, existing.username);
    const isActive = payload.is_active === undefined ? Boolean(existing.is_active) : normalizeActive(payload.is_active);
    if (id === Number(actorUserId) && !isActive) throw authError(409, "CANNOT_DISABLE_SELF", "不能停用当前登录账号");
    if (existing.role === "admin" && existing.is_active && (!isActive || role !== "admin") && activeAdminCount() <= 1) throw authError(409, "LAST_ADMIN_REQUIRED", "至少保留一个启用中的管理员");
    let passwordHash = existing.password_hash;
    let mustChange = existing.must_change_password;
    const nextPassword = payload.password ?? payload.temporary_password;
    if (nextPassword !== undefined) { passwordHash = await hashPassword(normalizePassword(nextPassword)); mustChange = 1; }
    const timestamp = iso();
    database.prepare("UPDATE users SET display_name=?,password_hash=?,role=?,is_active=?,must_change_password=?,updated_at=? WHERE id=?")
      .run(displayName, passwordHash, role, isActive ? 1 : 0, mustChange ? 1 : 0, timestamp, id);
    if (!isActive) database.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    return publicUser(database.prepare("SELECT * FROM users WHERE id=?").get(id));
  }

  async function changePassword(userId, currentPassword, nextPassword) {
    const id = Number(userId);
    const existing = database.prepare("SELECT * FROM users WHERE id=? AND is_active=1").get(id);
    if (!existing || !(await verifyPassword(currentPassword, existing.password_hash))) throw authError(401, "INVALID_PASSWORD", "当前密码错误");
    const passwordHash = await hashPassword(normalizePassword(nextPassword));
    const timestamp = iso();
    database.prepare("UPDATE users SET password_hash=?,must_change_password=0,last_login_at=COALESCE(last_login_at,?),updated_at=? WHERE id=?")
      .run(passwordHash, timestamp, timestamp, id);
    return publicUser(database.prepare("SELECT * FROM users WHERE id=?").get(id));
  }

  function audit(context, details = {}) {
    const before = details.before == null ? null : JSON.stringify(details.before);
    const after = details.after == null ? null : JSON.stringify(details.after);
    database.prepare(`INSERT INTO audit_log(user_id,action,method,path,target_type,target_id,before_json,after_json,result,ip_address,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(context?.user?.id ?? null, details.action || "request", context?.method || "", context?.path || "", details.target_type || null, details.target_id == null ? null : String(details.target_id), before, after, details.result || "success", context?.ip || null, iso());
  }

  function listAudit(limit = 200) {
    const bounded = Math.max(1, Math.min(1000, Number(limit) || 200));
    return database.prepare(`SELECT a.id,a.user_id,a.action,a.method,a.path,a.target_type,a.target_id,a.before_json,a.after_json,a.result,a.ip_address,a.created_at,u.username,u.display_name
      FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?`).all(bounded).map((row) => ({ ...row, before_json: row.before_json ? JSON.parse(row.before_json) : null, after_json: row.after_json ? JSON.parse(row.after_json) : null }));
  }

  function tokenFromRequest(request) {
    return parseCookies(request.headers.cookie || "")[cookieName] || null;
  }

  function cookieHeader(token, request) {
    const secure = request?.socket?.encrypted || options.secureCookie === true || process.env.AUTH_COOKIE_SECURE === "1";
    return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_IDLE_MS / 1000)}${secure ? "; Secure" : ""}`;
  }

  function clearCookieHeader(request) {
    const secure = request?.socket?.encrypted || options.secureCookie === true || process.env.AUTH_COOKIE_SECURE === "1";
    return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
  }

  return {
    authenticate,
    bootstrapFromEnv,
    clearCookieHeader,
    cookieHeader,
    createUser,
    get userCount() { return userCount(); },
    hasInitializedUsers: () => activeAdminCount() > 0,
    audit,
    listAudit,
    listUsers,
    login,
    logout,
    tokenFromRequest,
    updateUser,
    changePassword,
    publicUser,
    errors: { authError }
  };
}
