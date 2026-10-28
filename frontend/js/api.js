// API client for the FastAPI backend. It returns responses unchanged: the UI never computes recovery,
// thresholds, ΔTSR or model errors. Every response must match the contract and be marked synthetic.
import { CONFIG } from "./config.js";
import { authHeader, logout, noteServerResponse, refreshAccess, isPreview } from "./auth.js";

export class ApiError extends Error {
  constructor(message, code = "api_error", status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const cache = new Map();
const ID = /^[a-z0-9_]+$/;
const ID_PARAMS = new Set(["district", "disease", "scenario", "mask"]);
const SAFE = /^[A-Za-z0-9_.:-]{1,64}$/; // other params: view keys (cbe.dengue.baseline), dates, usernames, event names

export function clearApiCache() { cache.clear(); }

// Minimal contract checks: required keys per endpoint (see API_CONTRACT.md).
const REQUIRED = {
  meta: ["api_version", "dataset_version", "synthetic", "districts", "diseases", "scenarios", "recovery_rule", "horizon", "masks"],
  districts: ["synthetic", "districts"],
  simulations: ["synthetic", "months", "threshold_cases", "reference", "series", "recovery", "waves", "anomaly_windows"],
  "recovery-matrix": ["synthetic", "cells"],
  validation: ["synthetic", "rows", "summary_by_mask", "sensitivity"],
  "analytics/data-audit": ["synthetic", "checks", "catalog"],
  "analytics/eda": ["synthetic", "months", "trajectories_per_100k", "lag_correlations", "scenario_period"],
  "analytics/forecasts": ["synthetic", "months", "actual_per_100k", "models", "outbreak_months"],
  "analytics/forecast-summary": ["synthetic", "districts", "pooled"],
  "analytics/episodes": ["synthetic", "totals", "by_scenario", "matched", "timeline", "sensitivity", "unit_tests"],
  integrity: ["synthetic", "algorithm"],
  "integrity/verify": ["synthetic", "results"],
  "integrity/validate": ["synthetic", "checks"],
  "audit-log": ["synthetic", "entries"],
  exports: ["synthetic", "ok"],
  events: ["synthetic", "ok"],
  "me/saved": ["synthetic"],
  "me/favorites": ["synthetic", "favorites"],
  insights: ["synthetic", "insights"],
  comments: ["synthetic"],
  "admin/usage": ["synthetic", "per_day"],
  "admin/users": ["synthetic", "users"],
  "admin/comments": ["synthetic", "comments"],
  "admin/backups": ["synthetic", "backups"],
};

function checkContract(endpoint, body) {
  // Exact endpoint contracts; anything else (e.g. PATCH comments/5) must at least be marked synthetic.
  const missing = (REQUIRED[endpoint] || ["synthetic"]).filter((k) => !(k in body));
  if (missing.length) throw new ApiError(`The API response for ${endpoint} is missing: ${missing.join(", ")}.`, "contract_mismatch");
  if (body.synthetic !== true) {
    throw new ApiError("The API response is not marked as synthetic data, so it is not shown. This interface only displays synthetic research data.", "not_synthetic");
  }
  if (endpoint === "simulations") {
    const n = body.months.length;
    const arrays = [body.threshold_cases, body.series.baseline.observed_cases, body.series.scenario.observed_cases];
    if (arrays.some((a) => !Array.isArray(a) || a.length !== n)) throw new ApiError("Series lengths in the simulation response do not match its months.", "contract_mismatch");
  }
}

async function call(endpoint, { params = {}, method = "GET", body = null, cacheable = method === "GET" } = {}) {
  if (isPreview() && method !== "GET") throw new ApiError("This is a read-only preview. Exit the preview to make changes.", "preview_read_only", 403);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "" && !(ID_PARAMS.has(k) ? ID : SAFE).test(String(v))) throw new ApiError(`Invalid ${k} "${v}".`, "bad_request");
  }
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  const url = `${CONFIG.API_BASE}/${endpoint}${qs ? `?${qs}` : ""}`;
  const key = `${method}:${url}`;
  if (cacheable && cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method, signal: ctrl.signal,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...authHeader() },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError(e.name === "AbortError" ? "The data service took too long to respond. Try again." :
        "Could not reach the backend. Check that the server is running (python -m backend).", "network");
    } finally {
      clearTimeout(timer);
    }
    let json;
    try { json = await res.json(); } catch { json = null; }
    if (res.status === 401) {
      clearApiCache();
      const changed = ["session_changed", "account_disabled"].includes(json?.error?.code);
      logout(changed ? "changed" : "expired");
      throw new ApiError(changed ? json.error.message : "Your session has expired. Sign in again.", json?.error?.code || "unauthorized", 401);
    }
    // A 403 can mean an admin changed this account's role while it was signed in: re-read access, then report.
    if (res.status === 403 && json?.error?.code === "forbidden") refreshAccess().catch(() => {});
    noteServerResponse(res);
    if (!res.ok) {
      const msg = json?.error?.message || (res.status === 404 ? "No data exists for this selection." : `The data service returned an error (${res.status}).`);
      throw new ApiError(msg, json?.error?.code || `http_${res.status}`, res.status);
    }
    if (!json) throw new ApiError("The data service returned a response that is not JSON.", "bad_json");
    checkContract(endpoint, json);
    return json;
  })();
  if (cacheable) {
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
  }
  return promise;
}

// "none" is the default mask; it is never sent.
const maskParam = (mask) => (mask && mask !== "none" ? mask : null);

export const api = {
  meta: () => call("meta"),
  districts: () => call("districts"),
  simulation: ({ district, disease, scenario, mask }) => call("simulations", { params: { district, disease, scenario, mask: maskParam(mask) } }),
  recoveryMatrix: ({ disease, mask }) => call("recovery-matrix", { params: { disease, mask: maskParam(mask) } }),
  validation: ({ disease }) => call("validation", { params: { disease } }),
  dataAudit: () => call("analytics/data-audit"),
  eda: ({ district, disease }) => call("analytics/eda", { params: { district, disease } }),
  forecasts: ({ district, disease }) => call("analytics/forecasts", { params: { district, disease } }),
  forecastSummary: ({ disease }) => call("analytics/forecast-summary", { params: { disease } }),
  episodes: ({ disease }) => call("analytics/episodes", { params: { disease } }),
  integrity: () => call("integrity", { cacheable: false }),
  verifyIntegrity: () => call("integrity/verify", { method: "POST" }),
  runValidation: () => call("integrity/validate", { method: "POST" }),
  auditLog: () => call("audit-log", { cacheable: false }),
  /** Ask the server before any export; it checks the role and logs the request. Throws ApiError (403) if not allowed. */
  logExport: (kind, ctx = {}) => call("exports", { method: "POST", body: { kind, ...ctx, mask: maskParam(ctx.mask) } }),
  // personal state
  saved: () => call("me/saved", { cacheable: false }),
  saveView: (view) => call("me/saved", { method: "POST", body: { ...view, mask: maskParam(view.mask) || "none" } }),
  deleteSaved: (id) => call(`me/saved/${Number(id)}`, { method: "DELETE" }),
  favorites: () => call("me/favorites", { cacheable: false }),
  addFavorite: (district) => call("me/favorites", { method: "POST", body: { district } }),
  removeFavorite: (district) => call(`me/favorites/${district}`, { method: "DELETE" }),
  insights: ({ district, disease, scenario }) => call("insights", { params: { district, disease, scenario }, cacheable: false }),
  // comments (always plain text; the UI renders them as text)
  comments: (view) => call("comments", { params: { view }, cacheable: false }),
  postComment: (view, text, month = null) => call("comments", { method: "POST", body: { view, text, month } }),
  editComment: (id, text) => call(`comments/${Number(id)}`, { method: "PATCH", body: { text } }),
  deleteComment: (id) => call(`comments/${Number(id)}`, { method: "DELETE" }),
  // admin console
  usage: ({ from, to } = {}) => call("admin/usage", { params: { from, to }, cacheable: false }),
  users: () => call("admin/users", { cacheable: false }),
  createUser: (u) => call("admin/users", { method: "POST", body: u }),
  updateUser: (username, patch) => call(`admin/users/${username}`, { method: "PATCH", body: patch }),
  resetPassword: (username, password) => call(`admin/users/${username}/password`, { method: "POST", body: { password } }),
  auditQuery: ({ user, event, from, to, limit } = {}) => call("audit-log", { params: { user, event, from, to, limit }, cacheable: false }),
  adminComments: () => call("admin/comments", { cacheable: false }),
  moderateComment: (id, hidden) => call(`admin/comments/${Number(id)}`, { method: "PATCH", body: { hidden } }),
  adminDeleteComment: (id) => call(`admin/comments/${Number(id)}`, { method: "DELETE" }),
  backups: () => call("admin/backups", { cacheable: false }),
  createBackup: () => call("admin/backups", { method: "POST" }),
};

// Usage events: screen opens and major actions only (no keystrokes, no free text). Debounced; never sent in a preview.
let lastEvent = "";
let lastEventAt = 0;
export function track(event, fields = {}) {
  if (isPreview()) return;
  const key = JSON.stringify([event, fields]);
  const now = Date.now();
  if (key === lastEvent && now - lastEventAt < 3000) return;
  lastEvent = key;
  lastEventAt = now;
  const clean = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v != null && ["screen", "district", "disease", "scenario"].includes(k)));
  call("events", { method: "POST", body: { event, ...clean } }).catch((err) => console.warn("usage event not recorded:", err.message));
}

/** Authenticated download of a non-JSON endpoint (e.g. the audit log CSV). Returns { blob, filename }. */
export async function downloadRaw(endpoint, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  const res = await fetch(`${CONFIG.API_BASE}/${endpoint}${qs ? `?${qs}` : ""}`, { headers: { ...authHeader() } });
  if (res.status === 401) { clearApiCache(); logout("expired"); throw new ApiError("Your session has expired. Sign in again.", "unauthorized", 401); }
  noteServerResponse(res);
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new ApiError(j?.error?.message || `Download failed (${res.status}).`, j?.error?.code || `http_${res.status}`, res.status);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "download";
  return { blob: await res.blob(), filename: name };
}
