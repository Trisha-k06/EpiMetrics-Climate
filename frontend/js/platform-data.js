// Shared content about users, access and delivery. Used by the Overview, the Platform & access screen,
// the assistant and the PDF, so all of them say the same thing.

export const END_USERS = [
  { id: "dso", name: "District Surveillance Officers (IDSP, Tamil Nadu)", task: "Estimate how long extra outbreak response is needed after floods or a delayed monsoon.", start: "simulator", startLabel: "Scenario simulator" },
  { id: "dph", name: "Directorate of Public Health and Preventive Medicine, Tamil Nadu", task: "Plan vector-control resources across districts by comparing recovery delays.", start: "recovery", startLabel: "Recovery & recurrence" },
  { id: "tnsdma", name: "Disaster management (TNSDMA)", task: "Combine flood and heat planning with epidemic risk and expected recovery time.", start: "recovery", startLabel: "District map" },
  { id: "research", name: "Researchers and students", task: "Test climate scenarios and recovery rules, and check how reliable the estimates are.", start: "validation", startLabel: "Validation & limits" },
];

// Plain wording for each permission id. WHO has which permission comes only from the server (/auth/me → roles).
export const PERM_TEXT = [
  { perm: "young", what: "Young Minds climate lab, quiz and glossary" },
  { perm: "data.read", what: "Scenario results, district map and comparisons" },
  { perm: "export.report", what: "Scenario report as PDF or print" },
  { perm: "saved", what: "Save views and pin favourite districts" },
  { perm: "comments.read", what: "Read team comments" },
  { perm: "insights", what: "Recommended insights" },
  { perm: "analysis.read", what: "Outbreak episodes, data explorer, forecast models" },
  { perm: "validation.read", what: "Validation & limits (ground truth)" },
  { perm: "export.data", what: "Download data as CSV and JSON" },
  { perm: "export.project", what: "Whole-project PDF" },
  { perm: "comments.post", what: "Post and edit team comments" },
  { perm: "admin", what: "Admin console: usage, users, backups, view as" },
  { perm: "audit.read", what: "Audit log" },
  { perm: "integrity.admin", what: "Verify files and run validation scripts" },
  { perm: "comments.moderate", what: "Hide or delete any comment" },
];

// status: "app" = working in this version now; "deploy" = needs a production deployment (HTTPS host)
export const SECURITY = [
  { area: "Access control", measure: "Four roles (Young Minds, viewer, analyst, admin) from one role matrix on the server. Every API call is checked against it and answered with 401 or 403; the website only hides what a role can't use.", status: "app" },
  { area: "User management", measure: "Admins create users, change roles, disable accounts and reset passwords. Any change ends that user's open sessions, and every change is audited.", status: "app" },
  { area: "Passwords", measure: "Stored on the server only as salted PBKDF2-SHA256 hashes (200,000 rounds), compared in constant time. Unknown usernames take the same time to check, so they can't be guessed from timing.", status: "app" },
  { area: "Sessions", measure: "Signed JWT (HS256) with a 15-minute sliding expiry, renewed by the server while you work; sign-out revokes it. The token is kept only for this browser tab.", status: "app" },
  { area: "Login protection", measure: "The server pauses sign-in for 30 seconds after 5 wrong passwords for one account, and after 20 from one network address.", status: "app" },
  { area: "Data integrity", measure: "A SHA-256 manifest of every data, code and website file. Admins re-check it on the server and in the browser, and run the 34 semantic checks, the engine check and the unit tests.", status: "app" },
  { area: "Input checking", measure: "IDs must match ^[a-z0-9_]+$ (else 400) and exist (else 404). Responses must match the API contract and be marked synthetic, or the website refuses them.", status: "app" },
  { area: "Browser protections", measure: "One origin for site and API (no CORS). Content-Security-Policy allows only this site's scripts; X-Frame-Options DENY, nosniff, no-referrer, and no-store caching for API answers.", status: "app" },
  { area: "Audit log", measure: "Sign-ins, failed sign-ins, role changes, exports, comment moderation, view-as previews, backups and integrity checks go to an append-only log that admins can filter and export as CSV.", status: "app" },
  { area: "Comments", measure: "Stored as plain text (never HTML), at most 1,000 characters and 10 a minute per person; admins can hide or delete any comment.", status: "app" },
  { area: "Backups", measure: "One click or one command writes a checksummed archive of the database, accounts, manifest and audit log; the newest 14 are kept and restore checks the checksum first.", status: "app" },
  { area: "Secrets", measure: "The token signing key comes from the EPIMETRICS_SECRET environment variable (or a random key per server start), never from website code.", status: "app" },
  { area: "Privacy by design", measure: "All data is synthetic, so no personal health information is stored or shown. Usage tracking keeps counts of screens and scenarios only (no keystrokes or free text); failed sign-ins are counted without a username; Young Minds can't type, save or comment.", status: "app" },
  { area: "Transport", measure: "HTTPS through a TLS proxy or hosting platform in front of the server.", status: "deploy" },
  { area: "Off-site copies", measure: "Copy the backups/ archives to separate storage on the hosting platform.", status: "deploy" },
];

export const SAAS = {
  summary: "EpiMetrics-Climate is designed to run as Software as a Service: one hosted copy of the website and API, used through a browser with an account, and updated centrally.",
  layers: [
    { name: "Browser", detail: "This website, with its own experience for Young Minds, viewers, analysts and admins. Nothing to install." },
    { name: "Web API (v1)", detail: "FastAPI service answering /meta, /simulations, /recovery-matrix, /validation, /analytics, /auth, /exports and /integrity." },
    { name: "Recovery engine and models", detail: "Computes thresholds, TSR, ΔTSR, secondary waves, outbreak episodes and the forecast benchmarks." },
    { name: "Versioned dataset", detail: "Synthetic dataset v0.1.1 with a checksum manifest." },
  ],
  tiers: [
    { name: "Research and teaching", who: "Students, researchers", includes: "All scenarios, reports, assistant; viewer or analyst accounts", price: "Free" },
    { name: "Institution", who: "Health departments, disaster agencies", includes: "Team accounts with roles, admin integrity checks, support, custom districts once real data is connected", price: "Subscription (proposed)" },
  ],
  delivery: ["Central releases: a new dataset or model version reaches every user at once (versioned API, now v1.0).", "Accounts and roles per organisation.", "Hosting option: FastAPI in Docker on Render, Railway or AWS, serving this website alongside the API."],
};
