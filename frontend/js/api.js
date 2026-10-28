// API client for the FastAPI backend. It returns responses unchanged: the UI never computes recovery,
// thresholds, ΔTSR or model errors. Every response must match the contract and be marked synthetic.
import { CONFIG } from "./config.js";
import { authHeader, logout, noteServerResponse } from "./auth.js";

export class ApiError extends Error {
  constructor(message, code = "api_error", status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const cache = new Map();
const ID = /^[a-z0-9_]+$/;

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
};

function checkContract(endpoint, body) {
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
  for (const [k, v] of Object.entries(params)) {
    if (v != null && !ID.test(String(v))) throw new ApiError(`Invalid ${k} "${v}".`, "bad_request");
  }
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
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
      logout("expired");
      throw new ApiError("Your session has expired. Sign in again.", "unauthorized", 401);
    }
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
};
