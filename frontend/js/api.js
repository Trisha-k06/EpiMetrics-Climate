// API client. The only module that knows whether data comes from mock files or the live backend.
// It returns responses unchanged: the UI never computes recovery, thresholds or ΔTSR.
import { CONFIG } from "./config.js";
import { authHeader, logout } from "./auth.js";

export class ApiError extends Error {
  constructor(message, code = "api_error", detail = null) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const cache = new Map();
const ID = /^[a-z_]+$/;

function mockPath(endpoint, params) {
  switch (endpoint) {
    case "meta": return "meta.json";
    case "simulations": return `simulations/${params.district}__${params.disease}__${params.scenario}.json`;
    case "recovery-matrix": return `recovery-matrix/${params.disease}.json`;
    case "validation": return `validation/${params.disease}.json`;
    case "integrity": return "integrity.json";
    default: throw new ApiError(`Unknown endpoint "${endpoint}".`, "unknown_endpoint");
  }
}

function liveUrl(endpoint, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
  return `${CONFIG.API_BASE}/${endpoint}${qs ? `?${qs}` : ""}`;
}

// Minimal contract checks: required keys per endpoint (see API_CONTRACT.md).
const REQUIRED = {
  meta: ["api_version", "dataset_version", "synthetic", "districts", "diseases", "scenarios", "recovery_rule", "horizon"],
  simulations: ["synthetic", "months", "threshold_cases", "reference", "series", "recovery", "waves", "anomaly_windows"],
  "recovery-matrix": ["synthetic", "cells"],
  validation: ["synthetic", "rows", "summary_by_mask", "sensitivity"],
  integrity: ["synthetic", "algorithm", "files"],
};

function checkContract(endpoint, body) {
  const missing = (REQUIRED[endpoint] || []).filter((k) => !(k in body));
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

async function request(endpoint, params = {}) {
  for (const [k, v] of Object.entries(params)) {
    if (v != null && !ID.test(String(v))) throw new ApiError(`Invalid ${k} "${v}".`, "bad_request");
  }
  const key = `${CONFIG.API_MODE}:${endpoint}:${JSON.stringify(params)}`;
  if (cache.has(key)) return cache.get(key);
  const url = CONFIG.API_MODE === "mock" ? `${CONFIG.MOCK_BASE}/${mockPath(endpoint, params)}` : liveUrl(endpoint, params);
  const promise = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", ...authHeader() } });
    } catch (e) {
      throw new ApiError(
        e.name === "AbortError" ? "The data service took too long to respond. Try again." :
          CONFIG.API_MODE === "live" ? `Could not reach the backend at ${CONFIG.API_BASE}. Check that the server is running.` :
            "Could not load the mock data files. Serve the app over HTTP (see README) rather than opening the file directly.",
        "network");
    } finally {
      clearTimeout(timer);
    }
    let body;
    try { body = await res.json(); } catch { body = null; }
    if (res.status === 401 && CONFIG.API_MODE === "live") { logout("expired"); throw new ApiError("Your session has expired. Sign in again.", "unauthorized"); }
    if (!res.ok) {
      const msg = body?.error?.message || (res.status === 404 ? "No data exists for this selection." : `The data service returned an error (${res.status}).`);
      throw new ApiError(msg, body?.error?.code || `http_${res.status}`);
    }
    if (!body) throw new ApiError("The data service returned a response that is not JSON.", "bad_json");
    checkContract(endpoint, body);
    return body;
  })();
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

export const api = {
  mode: () => CONFIG.API_MODE,
  meta: () => request("meta"),
  simulation: ({ district, disease, scenario }) => request("simulations", { district, disease, scenario }),
  recoveryMatrix: ({ disease }) => request("recovery-matrix", { disease }),
  validation: ({ disease }) => request("validation", { disease }),
  integrity: () => request("integrity"),
};
