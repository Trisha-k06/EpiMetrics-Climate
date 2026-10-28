// Sign-in, access and sessions. The server checks the password (POST /auth/login) and returns a signed JWT plus the
// role's screens and permissions (backend/roles.py is the only role matrix; nothing here lists roles by hand).
// The token lives in sessionStorage (this tab only). The server slides the session through X-Session-Token.
// Admins can preview another role read-only: the X-View-As header makes the server answer as that role.
import { CONFIG } from "./config.js";

const KEY = "epimetrics.session.v3";
const PREVIEW_KEY = "epimetrics.preview.v1";
const listeners = new Set();
let session = null;
let preview = null; // { role, access } while an admin previews another role
let watchTimer = 0;
let lastServerContact = 0;
let keepaliveBusy = false;

const idleMs = () => (CONFIG.AUTH?.SESSION_IDLE_MINUTES ?? 15) * 60 * 1000;
const keepaliveMs = () => (CONFIG.AUTH?.KEEPALIVE_MINUTES ?? 4) * 60 * 1000;

function save() {
  try {
    session ? sessionStorage.setItem(KEY, JSON.stringify(session)) : sessionStorage.removeItem(KEY);
    preview ? sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(preview)) : sessionStorage.removeItem(PREVIEW_KEY);
  } catch { /* storage unavailable */ }
}
function emit(reason) { listeners.forEach((fn) => fn(session, reason)); }

// Expiry time (ms) from the token's own exp claim. Timing only; the server is the real check.
function tokenExpiry(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="))).exp;
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch { return 0; }
}

export function onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function currentSession() { return session; }
/** The access the screens should follow: the previewed role while previewing, else the signed-in role. */
export function access() { return preview?.access || session?.access || null; }
export function roleMatrix() { return session?.roles || []; }
export function previewRole() { return preview?.role || null; }
export function isPreview() { return !!preview; }
/** Permission from the server's matrix. Writes are never allowed in a preview (the server refuses them too). */
export function can(perm, { write = false } = {}) {
  const a = access();
  if (!a || (write && preview)) return false;
  return a.permissions.includes(perm);
}
export function canOpen(screen) { const a = access(); return !!(a && a.screens.some((s) => s.id === screen)); }
const EXPORT_PERMS = { report_pdf: "export.report", print: "export.report", json: "export.data", csv: "export.data", project_pdf: "export.project" };
export function canExport(kind) { return can(EXPORT_PERMS[kind], { write: true }); }
export function authHeader() {
  if (!session?.token) return {};
  return preview ? { Authorization: `Bearer ${session.token}`, "X-View-As": preview.role } : { Authorization: `Bearer ${session.token}` };
}
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
  if (!body?.token || !body.access?.screens) throw new AuthError("The sign-in service returned an unexpected answer.");
  const now = Date.now();
  session = {
    username: body.user.username, display_name: body.user.display_name || body.user.username, role: body.user.role,
    token: body.token, expiresAt: tokenExpiry(body.token), signedInAt: now, lastActive: now,
    access: body.access, roles: body.roles || [],
  };
  preview = null;
  lastServerContact = now;
  save();
  startWatch();
  emit("login");
  return session;
}

/** reason: logout | timeout | expired | changed (an admin changed or disabled the account) */
export function logout(reason = "logout") {
  if (!session) return;
  const token = session.token;
  session = null;
  preview = null;
  save();
  clearInterval(watchTimer);
  if (reason === "logout" && token) {
    // Tell the server to revoke the session; the local sign-out does not wait for it.
    fetch(`${CONFIG.API_BASE}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
  }
  emit(reason);
}

/** Admin only: start (role) or end (null) a read-only preview. The server audits the switch. */
export async function setPreview(role) {
  if (!session) return;
  const res = await fetch(`${CONFIG.API_BASE}/admin/view-as`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ role: role || null }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new AuthError(body?.error?.message || `Preview failed (${res.status}).`);
  noteServerResponse(res);
  preview = body.preview ? { role: body.preview, access: body.access } : null;
  save();
  emit("preview");
}

/** Re-read access from the server (e.g. after a 403 that may mean the role changed). */
export async function refreshAccess() {
  if (!session) return null;
  const res = await fetch(`${CONFIG.API_BASE}/auth/me`, { headers: { Accept: "application/json", ...authHeader() } });
  const body = await res.json().catch(() => null);
  if (res.status === 401) { logout(body?.error?.code === "session_changed" || body?.error?.code === "account_disabled" ? "changed" : "expired"); return null; }
  if (!res.ok || !body?.access) return access();
  noteServerResponse(res);
  const before = JSON.stringify(access());
  if (body.preview && preview) preview.access = body.access; else session.access = body.access;
  session.roles = body.roles || session.roles;
  save();
  if (JSON.stringify(access()) !== before) emit("access");
  return access();
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
  try { await refreshAccess(); } catch { /* offline: the next real request will report it */ } finally { keepaliveBusy = false; }
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
    // Active = the user did something since the last server contact. An idle tab lets the token expire.
    const active = session.lastActive > lastServerContact;
    if (due && active) keepalive();
    emit("tick");
  }, 5000);
}

export function initAuth() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
    const now = Date.now();
    if (s && s.token && s.access?.screens && now - s.lastActive < idleMs() && (!s.expiresAt || now < s.expiresAt)) {
      session = s;
      preview = JSON.parse(sessionStorage.getItem(PREVIEW_KEY) || "null");
      lastServerContact = now;
      startWatch();
    }
  } catch { /* ignore */ }
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
}
