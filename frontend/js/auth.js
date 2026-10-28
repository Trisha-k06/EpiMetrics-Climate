// Sign-in, roles and sessions. The server checks the password (POST /auth/login) and returns a signed JWT;
// the browser never sees password hashes. The token lives in sessionStorage, so it ends when the tab closes.
// The server slides the session: when a token is over a minute old it returns a fresh one in X-Session-Token.
import { CONFIG } from "./config.js";
import { ROLES } from "./platform-data.js";

const KEY = "epimetrics.session.v2";
const listeners = new Set();
let session = null;
let watchTimer = 0;
let lastServerContact = 0;
let keepaliveBusy = false;

const idleMs = () => (CONFIG.AUTH?.SESSION_IDLE_MINUTES ?? 15) * 60 * 1000;
const keepaliveMs = () => (CONFIG.AUTH?.KEEPALIVE_MINUTES ?? 4) * 60 * 1000;

function save() {
  try { session ? sessionStorage.setItem(KEY, JSON.stringify(session)) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
function emit(reason) { listeners.forEach((fn) => fn(session, reason)); }

// Expiry time (ms) from the token's own exp claim. Display/timing only; the server is the real check.
function tokenExpiry(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="))).exp;
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch { return 0; }
}

export function onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function currentSession() { return session; }
export function currentRole() { return session ? ROLES[session.role] : null; }
export function can(perm) { const r = currentRole(); return !!(r && r[perm]); }
export function canOpen(route) { const r = currentRole(); return !!(r && r.screens.includes(route)); }
export function authHeader() { return session?.token ? { Authorization: `Bearer ${session.token}` } : {}; }
export function minutesLeft() {
  if (!session) return 0;
  return Math.max(0, Math.ceil((session.lastActive + idleMs() - Date.now()) / 60000));
}

/** Called by the API client after every authenticated response. */
export function noteServerResponse(res) {
  if (!session) return;
  lastServerContact = Date.now();
  const fresh = res.headers.get("X-Session-Token");
  if (fresh && fresh !== session.token) {
    session.token = fresh;
    session.expiresAt = tokenExpiry(fresh);
    save();
  }
}

export class AuthError extends Error {}

export async function login(username, password) {
  username = String(username || "").trim().toLowerCase();
  if (!username || !password) throw new AuthError("Enter your username and password.");
  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new AuthError("Could not reach the sign-in service. Check that the server is running (python -m backend).");
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new AuthError(body?.error?.message || `Sign-in failed (${res.status}).`);
  if (!body?.token || !ROLES[body.user?.role]) throw new AuthError("The sign-in service returned an unexpected answer.");
  const now = Date.now();
  session = {
    username: body.user.username, display_name: body.user.display_name || body.user.username, role: body.user.role,
    token: body.token, expiresAt: tokenExpiry(body.token), signedInAt: now, lastActive: now,
  };
  lastServerContact = now;
  save();
  startWatch();
  emit("login");
  return session;
}

export function logout(reason = "logout") {
  if (!session) return;
  const token = session.token;
  session = null;
  save();
  clearInterval(watchTimer);
  if (reason === "logout" && token) {
    // Tell the server to revoke the session; the local sign-out does not wait for it.
    fetch(`${CONFIG.API_BASE}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
  }
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

// While the user is active but the screens make no API calls, keep the server session alive.
async function keepalive() {
  if (!session || keepaliveBusy) return;
  keepaliveBusy = true;
  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/me`, { headers: { Accept: "application/json", ...authHeader() } });
    if (res.status === 401) logout("expired");
    else if (res.ok) noteServerResponse(res);
  } catch { /* offline: the next real request will report it */ } finally { keepaliveBusy = false; }
}

function startWatch() {
  clearInterval(watchTimer);
  watchTimer = setInterval(() => {
    if (!session) return;
    const now = Date.now();
    if (now - session.lastActive > idleMs()) { logout("timeout"); return; }
    if (session.expiresAt && now >= session.expiresAt) { logout("expired"); return; }
    const ttl = session.expiresAt ? session.expiresAt - lastServerContact : keepaliveMs();
    const due = now - lastServerContact >= Math.min(keepaliveMs(), ttl / 2);
    const active = now - session.lastActive < keepaliveMs();
    if (due && active) keepalive();
    emit("tick");
  }, 5000);
}

export function initAuth() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
    const now = Date.now();
    if (s && s.token && ROLES[s.role] && now - s.lastActive < idleMs() && (!s.expiresAt || now < s.expiresAt)) {
      session = s;
      lastServerContact = now;
      startWatch();
    }
  } catch { /* ignore */ }
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
}
