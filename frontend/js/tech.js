// Technologies used in EpiMetrics-Climate, in plain language.
// Shared by the "Technology & PDF" screen and the PDF export so both say the same thing.

export const TECH_GROUPS = [
  {
    id: "interface",
    title: "Website interface (frontend)",
    intro: "What runs in the browser and what the user sees.",
    items: [
      { name: "HTML5", used: "Gives each of the six screens its structure: header, navigation, sections, tables, drop-down menus and the scenario choice buttons. Proper HTML elements also make the site usable with a keyboard and screen reader.", where: "index.html" },
      { name: "CSS3", used: "Controls the look: colours, fonts, spacing and the light and dark themes. Flexbox and Grid arrange the layout, and media queries rearrange it for phones. A print style sheet formats pages for printing.", where: "css/app.css" },
      { name: "JavaScript (ES modules)", used: "Makes the site interactive: switching screens, reacting to selections, asking the backend for data and filling in the KPI cards, charts and tables. The code is split into small modules, one per job.", where: "js/" },
      { name: "SVG graphics", used: "Draws every chart: case curves, the endemic threshold, the recovery timeline and the validation scatter plot. SVG stays sharp at any size and can show tooltips when you hover.", where: "js/charts.js" },
      { name: "Three.js (WebGL 3D)", used: "Draws the rotating 3D district map: a schematic Tamil Nadu outline with a glowing pillar per district whose height shows the recovery result. Drag to rotate; select a pillar to choose a district. Browsers without 3D get a flat map instead. Stored inside the project, so it works offline.", where: "vendor/three.min.js, js/map3d.js, js/geo.js" },
      { name: "Day and Night mode", used: "A switch in the top bar changes every colour through CSS variables, including the charts and the 3D map. The app follows your device setting until you choose, then remembers the choice.", where: "js/theme.js, css/app.css" },
      { name: "CSS animation and 3D transforms", used: "Screens slide in, chart lines draw themselves, numbers count up, and cards tilt gently towards the mouse. All motion switches off when the device asks for reduced motion.", where: "css/app.css, js/app.js" },
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
      { name: "jsPDF", used: "Builds the project summary PDF directly in the browser, with text, tables and a chart. It is stored inside the project, so it works without internet.", where: "vendor/jspdf.umd.min.js, js/pdf.js" },
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
      { name: "Validation scripts", used: "Check every table against the data dictionary and run 34 independent checks, including recomputing all 70 true recovery times.", where: "src/validate_data.py, src/verify_semantics.py" },
      { name: "Web API (planned)", used: "A Python web server will answer the frontend's requests in the format set by API_CONTRACT.md. Until then, the frontend reads mock files with the same format.", where: "API_CONTRACT.md, mock/api/v1/" },
    ],
  },
  {
    id: "dev",
    title: "Development and testing",
    intro: "Tools used to build and check the project.",
    items: [
      { name: "Python http.server", used: "Runs the website on your computer for development and demos (python3 -m http.server 8000).", where: "README.md" },
      { name: "Mock API builder", used: "Turns the dataset into the JSON files the frontend reads, using the project's own recovery engine. It fails if any result differs from the published outputs.", where: "tools/build_mock_api.py" },
      { name: "Playwright (headless browser)", used: "Opened every screen automatically at desktop and phone sizes and in dark mode, to catch layout problems and script errors.", where: "development only" },
    ],
  },
];

export const PIPELINE = [
  { name: "Configuration", detail: "Districts, diseases, scenarios and rules in JSON" },
  { name: "Data generator", detail: "Python creates synthetic climate and cases" },
  { name: "Dataset", detail: "19 CSV tables, checked and documented" },
  { name: "Recovery engine", detail: "Computes TSR, ΔTSR and secondary waves" },
  { name: "API", detail: "Sends results as JSON (mock files for now)" },
  { name: "Website", detail: "Six screens, 3D map and charts show the results" },
  { name: "Reports", detail: "PDF summary, scenario report, CSV and JSON" },
];
