// Technologies used in EpiMetrics-Climate, in plain language.
// Shared by the "Technology & PDF" screen and the PDF export so both say the same thing.

export const TECH_GROUPS = [
  {
    id: "interface",
    title: "Website interface (frontend)",
    intro: "What runs in the browser and what the user sees.",
    items: [
      { name: "HTML5", used: "Gives every screen its structure, for four audiences (Young Minds, viewers, analysts, admins): header, navigation, sections, tables, drop-down menus and the scenario choice buttons. Proper HTML elements also make the site usable with a keyboard and screen reader.", where: "index.html" },
      { name: "CSS3", used: "Controls the look: colours, fonts, spacing and the light and dark themes. Flexbox and Grid arrange the layout, and media queries rearrange it for phones. A print style sheet formats pages for printing.", where: "css/app.css" },
      { name: "JavaScript (ES modules)", used: "Makes the site interactive: switching screens, reacting to selections, asking the backend for data and filling in the KPI cards, charts and tables. The code is split into small modules, one per job.", where: "js/" },
      { name: "SVG graphics", used: "Draws every chart: case curves, the endemic threshold, the recovery timeline, grouped bar charts, forecast comparisons and the validation scatter plot. SVG stays sharp at any size and can show tooltips when you hover.", where: "js/charts.js" },
      { name: "Three.js (WebGL 3D)", used: "Draws the 3D map of Tamil Nadu's 32 districts. The five study districts are raised and coloured by the result, with a pole whose height shows the value, plus a legend, compass, scale bar and India locator. Drag to rotate; select a district to open it. Browsers without 3D get a flat map instead. Stored inside the project, so it works offline.", where: "vendor/three.min.js, js/map3d.js" },
      { name: "District boundaries (GeoJSON)", used: "Real Census 2011 district and state boundaries from the DataMeet India community (CC BY 4.0), simplified to a 78 KB file for fast loading. Used for display and orientation only.", where: "data/geo/tamil_nadu.json, tools/build_geo.py" },
      { name: "Day and Night mode", used: "A switch in the top bar changes every colour through CSS variables, including the charts and the 3D map. The app follows your device setting until you choose, then remembers the choice.", where: "js/theme.js, css/app.css" },
      { name: "CSS animation and 3D transforms", used: "Screens slide in, chart lines draw themselves, numbers count up, and cards tilt gently towards the mouse. All motion switches off when the device asks for reduced motion.", where: "css/app.css, js/app.js" },
      { name: "Sign-in and roles", used: "Viewer, analyst and admin accounts. The server checks the password and returns a signed JWT that it renews while you work; the browser keeps it only for this tab and signs out after 15 idle minutes.", where: "js/auth.js, js/screens/login.js" },
      { name: "Checksum verification (SHA-256, Web Crypto)", used: "A manifest holds the fingerprint of every data, code and website file. Admins re-check it on the server, and the website files again in the browser, to prove nothing was altered.", where: "js/screens/platform.js, backend/integrity.py" },
      { name: "Role-based experiences", used: "The menu, home screen and every button follow the role matrix sent by the server: a playful Young Minds lab, a plain-language viewer mode, the full analyst toolkit, and the admin console. An admin can preview each one read-only.", where: "js/app.js, js/auth.js, backend/roles.py" },
      { name: "Young Minds mode", used: "A separate playful shell for students: illustrated scenes and original SVG art, weather sliders mapped to the predefined scenarios, an animated recovery journey from real API values, a quiz with browser-only badges and a kid glossary. No typing, saving, comments or exports.", where: "js/young/" },
      { name: "Plain-language glossary", used: "One module of definitions feeds every \"i\" tooltip, the assistant and the PDFs, so a term is explained the same way everywhere.", where: "js/glossary.js, js/components/tooltip.js" },
      { name: "Compare, drill-downs, saved views, comments", used: "Two climates side by side; district › disease › year › month drill-downs with breadcrumbs; views and favourite districts saved on the server; team comments pinned to months and included in the report PDF.", where: "js/screens/compare.js, js/components/" },
      { name: "Basic assistant", used: "A chat panel that answers questions from the project's definitions and the API results (including the best forecast model and episode counts), with no AI service. Refuses medical questions.", where: "js/assistant.js" },
      { name: "Fetch API and JSON", used: "Fetches results from the backend. Data travels as JSON, a simple text format that Python and JavaScript both read. Every response is checked against the agreed contract and must be marked as synthetic.", where: "js/api.js, API_CONTRACT.md" },
      { name: "Browser storage (localStorage)", used: "Remembers your last district, disease and scenario, so the app opens where you left off. Nothing is sent anywhere.", where: "js/state.js" },
      { name: "Google Fonts (IBM Plex, Chakra Petch)", used: "Clear, readable typefaces for text and numbers, with a technical display face for headings. If they cannot load, the browser's own fonts are used instead.", where: "index.html" },
    ],
  },
  {
    id: "export",
    title: "Reports and export",
    intro: "How results leave the app.",
    items: [
      { name: "jsPDF", used: "Builds the project summary PDF and the scenario report PDF directly in the browser, with text, tables and a vector case chart. It is stored inside the project, so it works without internet.", where: "vendor/jspdf.umd.min.js, js/pdf.js" },
      { name: "jsPDF-AutoTable", used: "Lays out the tables in the PDF (scenarios, results, validation) with headers that repeat across pages.", where: "vendor/jspdf.plugin.autotable.min.js" },
      { name: "Print style sheet", used: "Lets the scenario report screen be printed or saved as a PDF from the browser, without menus and buttons.", where: "css/app.css (@media print)" },
      { name: "CSV and JSON downloads", used: "Exports the data behind a scenario report for spreadsheets or further analysis.", where: "js/screens/report.js" },
    ],
  },
  {
    id: "data",
    title: "Data, models and recovery engine (backend)",
    intro: "Python code that creates the synthetic data and computes every recovery result.",
    items: [
      { name: "Python 3", used: "The language of the data generator, the recovery engine and the checks. All the science of the project lives here.", where: "src/" },
      { name: "NumPy", used: "Fast maths on arrays: the monthly climate series, the disease model and seeded random numbers (seed 42), so the dataset is exactly reproducible.", where: "src/generate_data.py" },
      { name: "pandas", used: "Reads, joins and writes the data tables (CSV files) and builds the model-ready table with lag features.", where: "src/build_derived.py" },
      { name: "SciPy", used: "Supplies the negative-binomial distribution that turns expected cases into realistic, noisy reported cases.", where: "src/generate_data.py" },
      { name: "Recovery engine", used: "Applies the project's recovery rules: endemic threshold, Time to Sustained Recovery (TSR), secondary-wave detection, censoring and missing-data checks.", where: "src/recovery_engine.py" },
      { name: "CSV and JSON configuration", used: "CSV files hold the dataset (19 tables). JSON files hold every model setting (districts, diseases, scenarios, rules), so nothing is hidden in code.", where: "data/, configs/" },
      { name: "Validation scripts", used: "Check every table against the data dictionary and run 34 independent checks, including recomputing all 70 true recovery times. Admins can run the read-only checks from the website.", where: "src/validate_data.py, src/verify_semantics.py" },
      { name: "FastAPI and Uvicorn", used: "The web API (v1) and web server. One command, python -m backend, serves this website and every endpoint in API_CONTRACT.md on the same address, with security headers on every response.", where: "backend/app.py, backend/__main__.py" },
      { name: "statsmodels", used: "Fits the ARIMA, SARIMA, SARIMAX and lagged SARIMAX benchmarks of notebook 05. Fits are cached on disk and prepared in the background when the server starts.", where: "backend/analytics.py" },
      { name: "scikit-learn", used: "Trains the climate-aware random forest of notebook 04 (200 trees, depth 8) and reports which climate lags it relies on.", where: "backend/analytics.py" },
      { name: "SQLite (Python sqlite3)", used: "Stores saved views, favourite districts, team comments and anonymised usage events, with schema migrations in code and write-ahead logging. Feeds the admin usage dashboard and the recommended insights.", where: "backend/db.py" },
      { name: "Backups", used: "One click or one command writes a zip of the database (via the SQLite backup API), accounts, manifest and audit log with a SHA-256 checksum; restore checks the checksum first.", where: "backend/backup.py, backend/manage.py" },
      { name: "PyJWT and hashlib", used: "Sign and check session tokens (HS256) and hash passwords (PBKDF2-SHA256) on the server.", where: "backend/security.py" },
    ],
  },
  {
    id: "dev",
    title: "Development and testing",
    intro: "Tools used to build and check the project.",
    items: [
      { name: "pytest", used: "Checks the API against the notebooks' printed numbers (correlations, model errors, episode counts) and the recovery engine against all 280 published runs, plus the security rules.", where: "backend/tests/test_api.py" },
      { name: "Playwright (headless browser)", used: "Signs in as each role and opens every screen at desktop and phone sizes in Day and Night mode, failing on any script error, failed request or sideways scrolling; also tests exports, lock-out and session expiry.", where: "tests/e2e.py" },
    ],
  },
];

export const PIPELINE = [
  { name: "Configuration", detail: "Districts, diseases, scenarios and rules in JSON" },
  { name: "Data generator", detail: "Python creates synthetic climate and cases" },
  { name: "Dataset", detail: "19 CSV tables, checked and documented" },
  { name: "Recovery engine", detail: "Computes TSR, ΔTSR and secondary waves" },
  { name: "API", detail: "FastAPI sends results and analyses as JSON" },
  { name: "Website", detail: "Role-based screens, 3D map and charts show the results" },
  { name: "Reports", detail: "PDF summary, scenario report, CSV and JSON" },
];
