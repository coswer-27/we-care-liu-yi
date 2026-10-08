import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { get, run } from "./db.mjs";

const SESSION_DAYS = 30;
const COOKIE_NAME = "liuyi_session";

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, storedHash, salt) {
  const candidate = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "utf8");
  const expected = Buffer.from(storedHash, "utf8");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await run(
    `INSERT INTO sessions (token, user_id, created_at, expires_at)
     VALUES (:token, :user_id, :created_at, :expires_at)`,
    { token, user_id: userId, created_at: now.toISOString(), expires_at: expires.toISOString() }
  );
  return { token, expires };
}

export async function destroySession(token) {
  if (token) await run("DELETE FROM sessions WHERE token = :token", { token });
}

function parseCookies(header = "") {
  const jar = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function readSessionToken(req) {
  return parseCookies(req.headers.cookie || "")[COOKIE_NAME] || null;
}

/** Returns the logged-in user for this request, or null. Expired sessions are cleaned up. */
export async function currentUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;

  const session = await get("SELECT * FROM sessions WHERE token = :token", { token });
  if (!session) return null;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }

  const user = await get("SELECT id, email, display_name, created_at FROM users WHERE id = :id", {
    id: session.user_id
  });
  return user || null;
}

export function sessionCookie(token, expires, secure) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearedCookie(secure) {
  const attrs = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function validateCredentials({ email, password, displayName }, { requireName = false } = {}) {
  const errors = [];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("請輸入有效的電子郵件。");
  if (!password || password.length < 8) errors.push("密碼至少需要 8 個字元。");
  if (requireName && (!displayName || displayName.trim().length < 1)) errors.push("請輸入暱稱。");
  return errors;
}
