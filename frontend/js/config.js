// Frontend configuration. The website and the FastAPI backend run on one origin (python -m backend).
export const CONFIG = {
  API_BASE: "/api/v1",
  // The first forecast-model fits on a fresh server can take a while.
  REQUEST_TIMEOUT_MS: 60000,
  // Exports. Leave on for the local app; a hosted preview can turn them off.
  ENABLE_FILE_DOWNLOADS: true,
  ENABLE_PRINT: true,
  // First selection when the app opens: the main demo case.
  // Coimbatore dengue shows both demo effects clearly (TSR 3 → 13 months under both rain scenarios).
  DEFAULT_SELECTION: { district: "cbe", disease: "dengue", scenario: "delayed_monsoon", mask: "none" },
  // Scenarios used by the guided demo on the simulator, in order.
  DEMO_SEQUENCE: ["baseline", "delayed_monsoon", "heavy_rain_decline"],
  // Months shown by default on time charts (the outbreak and recovery period).
  FOCUS_RANGE: { start: "2021-07", end: "2024-12" },
  // Sign-in. The server checks passwords and issues a signed token; the browser keeps it for this tab only.
  AUTH: { SESSION_IDLE_MINUTES: 15, KEEPALIVE_MINUTES: 4 },
};
