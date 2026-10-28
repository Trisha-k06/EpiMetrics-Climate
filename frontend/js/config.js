// Frontend configuration. Switch API_MODE to "live" once the Python backend is running.
export const CONFIG = {
  // "mock": read the JSON files in ./mock/api/v1 (same shapes as the live API)
  // "live": call the backend at API_BASE (see API_CONTRACT.md)
  API_MODE: "mock",
  API_BASE: "/api/v1",
  MOCK_BASE: "./mock/api/v1",
  REQUEST_TIMEOUT_MS: 15000,
  // Exports. Leave on for the local app; the hosted preview turns them off.
  ENABLE_FILE_DOWNLOADS: true,
  ENABLE_PRINT: true,
  // First selection when the app opens: the main demo case.
  // Coimbatore dengue shows both demo effects clearly (TSR 3 → 13 months under both rain scenarios).
  DEFAULT_SELECTION: { district: "cbe", disease: "dengue", scenario: "delayed_monsoon" },
  // Scenarios used by the guided demo on the simulator, in order.
  DEMO_SEQUENCE: ["baseline", "delayed_monsoon", "heavy_rain_decline"],
  // Months shown by default on time charts (the outbreak and recovery period).
  FOCUS_RANGE: { start: "2021-07", end: "2024-12" },
  // Sign-in and roles. Set REQUIRED to false to skip the sign-in screen during development.
  AUTH: { REQUIRED: true, SESSION_IDLE_MINUTES: 15 },
};
