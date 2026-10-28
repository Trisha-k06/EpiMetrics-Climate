# EpiMetrics-Climate — frontend

HTML5 / CSS / JavaScript interface for the EpiMetrics-Climate recovery and recurrence simulator.
There is no framework and no build step: ES modules, hand-drawn SVG charts, one stylesheet.

> Synthetic data only. The interface never presents results as Tamil Nadu forecasts or clinical advice,
> and it refuses any API response that is not flagged `"synthetic": true`.

## Run it

```bash
cd epimetrics-ui
python -m http.server 8000
# open http://localhost:8000
```

It must be served over HTTP. Opening `index.html` directly from disk blocks the module and JSON loads.

## Six screens

| Hash | Screen | Main endpoint |
|---|---|---|
| `#overview` | Project overview, objective (TSR / ΔTSR), definitions, scope, scenarios | `/meta`, `/simulations` (example) |
| `#simulator` | District, disease and 7-scenario selectors, guided demo, KPI cards, baseline-vs-scenario cases, threshold, t0, recovery months, secondary-wave markers, recovery timeline, rainfall and temperature | `/simulations` |
| `#recovery` | ΔTSR / interruptions / months-above-threshold matrix for all scenarios × districts; click a cell for its timeline and wave table | `/recovery-matrix`, `/simulations` |
| `#validation` | Estimated vs true TSR, missing-data tests, p10–p90 spread, recovery-rule sensitivity, limitations | `/validation` |
| `#report` | One-page scenario report: print or save as PDF, download JSON and CSV, copy summary | `/simulations` |
| `#technology` | Technologies used and what each is for; **Export PDF** builds a plain-language summary of the whole project | all four |

## Connecting the backend

1. Implement the endpoints in `API_CONTRACT.md` (same JSON shapes as the files in `mock/api/v1/`).
2. In `js/config.js` set `API_MODE: "live"` and `API_BASE` to your server (default `/api/v1`).
   If the API is on another origin, enable CORS for it.
3. The badge in the top bar changes from **Mock API** to **Live API**.

The frontend does not compute recovery. TSR, ΔTSR (including censored lower bounds), recovery months,
wave onsets and validation metrics all come from the API. If a field is missing, the UI shows
"Not provided by the API" instead of working it out.

## Mock data

`mock/api/v1/` is generated from dataset v0.1.1 by running the project's own `src/recovery_engine.py`:

```bash
python tools/build_mock_api.py ../epimetrics_ukm
```

The script checks every series against `outputs/simulation_runs.csv` and fails if any recovery result
differs (currently 0 mismatches across 70 series).

## Files

```
index.html              app shell (top bar, synthetic-data strip, screen nav, footer)
css/app.css             design tokens (light and dark), layout, components, print styles
js/config.js            mock/live switch, API base, default selection, demo sequence
js/api.js               the only module that fetches; contract and synthetic-flag checks
js/state.js             shared district/disease/scenario selection
js/format.js            display formatting (no recovery logic)
js/charts.js            SVG time chart, recovery timeline, validation scatter
js/ui.js                selectors, KPI cards, composed simulation view, tables
js/screens/*.js         the six screens
js/tech.js              technology list shared by screen 6 and the PDF
js/pdf.js               whole-project PDF export (jsPDF)
js/map3d.js, js/geo.js  3D district map (Three.js) with 2D fallback; schematic outline
js/theme.js             Day / Night mode
vendor/                 Three.js r149, jsPDF 2.5.1, jsPDF-AutoTable 3.8.2 (MIT licences included)
mock/api/v1/            mock responses (75 files)
tools/build_mock_api.py builds the mock responses from the dataset
API_CONTRACT.md         the agreed API schema
```

## Look and feel

- Futuristic glass interface with a Day / Night switch in the top bar (follows the device until you choose).
- 3D district map on the Overview and Recovery screens: drag to rotate, select a pillar or a name. It is a schematic, labelled as such.
- Motion (screen entrance, line drawing, count-up, card tilt, map rotation) stops when the device asks for reduced motion.

## Accessibility and responsiveness

- Works from 360 px phones to wide desktops; the screen nav becomes tabs on small screens.
- Light and dark themes follow the system setting.
- Baseline is blue and scenario orange everywhere (colour-blind-safe pair); every chart also has a legend,
  hover tooltips and a "Show the data" table.
- Keyboard navigable with visible focus; scenario choice uses real radio buttons.
