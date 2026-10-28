// Shared content about users, access and delivery. Used by the Overview, the Platform & access screen,
// the assistant and the PDF, so all of them say the same thing.

export const END_USERS = [
  { id: "dso", name: "District Surveillance Officers (IDSP, Tamil Nadu)", task: "Estimate how long extra outbreak response is needed after floods or a delayed monsoon.", start: "simulator", startLabel: "Scenario simulator" },
  { id: "dph", name: "Directorate of Public Health and Preventive Medicine, Tamil Nadu", task: "Plan vector-control resources across districts by comparing recovery delays.", start: "recovery", startLabel: "Recovery & recurrence" },
  { id: "tnsdma", name: "Disaster management (TNSDMA)", task: "Combine flood and heat planning with epidemic risk and expected recovery time.", start: "recovery", startLabel: "District map" },
  { id: "research", name: "Researchers and students", task: "Test climate scenarios and recovery rules, and check how reliable the estimates are.", start: "validation", startLabel: "Validation & limits" },
];

export const ROLES = {
  viewer: { label: "Viewer", summary: "Reads results", screens: ["overview", "simulator", "recovery", "report", "technology", "platform"], exports: false, validation: false, integrity: false },
  analyst: { label: "Analyst", summary: "Runs scenarios, sees validation, exports reports", screens: ["overview", "simulator", "recovery", "validation", "report", "technology", "platform"], exports: true, validation: true, integrity: false },
  admin: { label: "Admin", summary: "Everything, plus data-integrity checks", screens: ["overview", "simulator", "recovery", "validation", "report", "technology", "platform"], exports: true, validation: true, integrity: true },
};

export const PERMISSIONS = [
  { what: "Overview, simulator, recovery map and grid", viewer: true, analyst: true, admin: true },
  { what: "Scenario report (on screen)", viewer: true, analyst: true, admin: true },
  { what: "Validation & limits screen", viewer: false, analyst: true, admin: true },
  { what: "Export PDF, JSON and CSV", viewer: false, analyst: true, admin: true },
  { what: "Verify data integrity (checksums)", viewer: false, analyst: false, admin: true },
  { what: "Ask the assistant", viewer: true, analyst: true, admin: true },
];

// status: "app" = working in this app now; "backend" = needs the live backend (planned)
export const SECURITY = [
  { area: "Access control", measure: "Sign-in with three roles (viewer, analyst, admin); each screen and export checks the role.", status: "app" },
  { area: "Passwords", measure: "Stored only as salted hashes (PBKDF2-SHA256, 100,000 rounds), never as plain text. Live: verified on the server, which issues a signed JWT.", status: "app" },
  { area: "Session timeout", measure: "Signed out automatically after 15 minutes without activity; the session ends when the tab closes.", status: "app" },
  { area: "Login protection", measure: "Sign-in pauses for 30 seconds after 5 wrong passwords. Live: also rate-limited on the server.", status: "app" },
  { area: "Data integrity", measure: "A SHA-256 checksum manifest of every data file; admins can re-check the files at any time. The backend's validation scripts catch tampering in the dataset.", status: "app" },
  { area: "Input checking", measure: "Only known district, disease and scenario IDs are sent; responses must match the API contract and be marked synthetic.", status: "app" },
  { area: "Privacy by design", measure: "All data is synthetic, so no personal health information is stored or shown.", status: "app" },
  { area: "Transport and origin", measure: "HTTPS only, CORS limited to our own site, API rate limiting.", status: "backend" },
  { area: "Secrets", measure: "Keys and passwords kept in server environment variables, never in website code.", status: "backend" },
  { area: "Audit log and backups", measure: "Record who ran which scenario and when; versioned, backed-up data and a private Git repository.", status: "backend" },
];

export const SAAS = {
  summary: "EpiMetrics-Climate is designed to run as Software as a Service: one hosted copy of the website and API, used through a browser with an account, and updated centrally.",
  layers: [
    { name: "Browser", detail: "This website: six screens, map, reports, assistant. Nothing to install." },
    { name: "Hosted web API (v1)", detail: "Python service (planned) answering /meta, /simulations, /recovery-matrix, /validation, /auth and /integrity." },
    { name: "Recovery engine", detail: "Computes thresholds, TSR, ΔTSR, secondary waves and validation." },
    { name: "Versioned dataset", detail: "Synthetic dataset v0.1.1 with a checksum manifest." },
  ],
  tiers: [
    { name: "Research and teaching", who: "Students, researchers", includes: "All scenarios, reports, assistant; viewer or analyst accounts", price: "Free" },
    { name: "Institution", who: "Health departments, disaster agencies", includes: "Team accounts with roles, admin integrity checks, support, custom districts once real data is connected", price: "Subscription (proposed)" },
  ],
  delivery: ["Central releases: a new dataset or model version reaches every user at once (versioned API, now v1.0).", "Accounts and roles per organisation.", "Hosting option: FastAPI in Docker on Render, Railway or AWS, serving this website alongside the API."],
};
