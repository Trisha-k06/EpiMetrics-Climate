// Sign-in, roles and session timeout.
// Mock mode: demo accounts whose passwords exist only as salted PBKDF2-SHA256 hashes; the check runs in the
// browser for demonstration. Live mode: POST /auth/login on the backend, which verifies the password and
// returns a signed JWT; the browser never sees password hashes.
import { CONFIG } from "./config.js";
import { ROLES } from "./platform-data.js";

const KEY = "epimetrics.session.v1";
const listeners = new Set();
let session = null;
let failed = 0, lockedUntil = 0;
let idleTimer = 0;

const idleMs = () => (CONFIG.AUTH?.SESSION_IDLE_MINUTES ?? 15) * 60 * 1000;

function save() {
  try { session ? sessionStorage.setItem(KEY, JSON.stringify(session)) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
function emit(reason) { listeners.forEach((fn) => fn(session, reason)); }

export function onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function currentSession() { return session; }
export function currentRole() { return session ? ROLES[session.role] : null; }
export function authRequired() { return CONFIG.AUTH?.REQUIRED !== false; }
export function can(perm) {
  if (!authRequired()) return true;
  const r = currentRole();
  return !!(r && r[perm]);
}
export function canOpen(route) {
  if (!authRequired()) return true;
  const r = currentRole();
  return !!(r && r.screens.includes(route));
}
export function authHeader() {
  return session?.token && CONFIG.API_MODE === "live" ? { Authorization: `Bearer ${session.token}` } : {};
}
export function minutesLeft() {
  if (!session) return 0;
  return Math.max(0, Math.ceil((session.lastActive + idleMs() - Date.now()) / 60000));
}

function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function fromHex(h) { return new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16))); }
function randomToken() { const a = new Uint8Array(24); crypto.getRandomValues(a); return hex(a); }

async function pbkdf2(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations }, key, 256);
  return hex(bits);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export class AuthError extends Error {}

export async function login(username, password) {
  if (Date.now() < lockedUntil) {
    throw new AuthError(`Too many wrong attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)} seconds.`);
  }
  username = String(username || "").trim().toLowerCase();
  if (!username || !password) throw new AuthError("Enter your username and password.");
  let user = null;
  if (CONFIG.API_MODE === "live") {
    const res = await fetch(`${CONFIG.API_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }).catch(() => null);
    if (!res) throw new AuthError(`Could not reach the sign-in service at ${CONFIG.API_BASE}.`);
    if (res.ok) {
      const b = await res.json();
      user = { username: b.user.username, display_name: b.user.display_name || b.user.username, role: b.user.role, token: b.token };
    }
  } else {
    if (!crypto?.subtle) throw new AuthError("Secure sign-in needs the app to run from http://localhost or https.");
    const res = await fetch(`${CONFIG.MOCK_BASE}/auth/demo-users.json`);
    const db = await res.json();
    const u = db.users.find((x) => x.username === username);
    // hash even for unknown users so timing does not reveal which usernames exist
    const h = await pbkdf2(password, u?.salt || "00".repeat(16), u?.iterations || 100000);
    if (u && safeEqual(h, u.hash)) user = { username: u.username, display_name: u.display_name, role: u.role, token: randomToken() };
  }
  if (!user || !ROLES[user.role]) {
    failed += 1;
    if (failed >= 5) { lockedUntil = Date.now() + 30000; failed = 0; throw new AuthError("Too many wrong attempts. Sign-in is paused for 30 seconds."); }
    throw new AuthError("Username or password is incorrect.");
  }
  failed = 0;
  const now = Date.now();
  session = { ...user, signedInAt: now, lastActive: now };
  save();
  startIdleWatch();
  emit("login");
  return session;
}

export function logout(reason = "logout") {
  session = null;
  save();
  clearInterval(idleTimer);
  emit(reason);
}

let lastTouch = 0;
function touch() {
  if (!session) return;
  const now = Date.now();
  if (now - lastTouch < 5000) return;
  lastTouch = now;
  session.lastActive = now;
  save();
}
function startIdleWatch() {
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (!session) return;
    if (Date.now() - session.lastActive > idleMs()) logout("timeout");
    else emit("tick");
  }, 15000);
}

export function initAuth() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (s && s.role && ROLES[s.role] && Date.now() - s.lastActive < idleMs()) { session = s; startIdleWatch(); }
  } catch { /* ignore */ }
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
}
