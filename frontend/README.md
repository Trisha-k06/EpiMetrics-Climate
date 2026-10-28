# EpiMetrics-Climate — frontend

HTML5 / CSS / JavaScript interface for the EpiMetrics-Climate recovery and recurrence simulator.
There is no framework and no build step: ES modules, hand-drawn SVG charts, one stylesheet.
It is served by the FastAPI backend in `../backend/` on the same address as the API.

> Synthetic data only. The interface never presents results as Tamil Nadu forecasts or clinical advice,
> and it refuses any API response that is not flagged `"synthetic": true`.

## Run it

From the repository root:

```bash
pip3 install -r requirements.txt
python -m backend          # open http://127.0.0.1:8000
```

The page and `/api/v1` share one origin, so there is no CORS. The Content-Security-Policy only allows
scripts from this site, so every script lives under `frontend/` (Three.js and jsPDF are in `vendor/`).

## Ten screens

| Hash | Screen | Endpoints |
|---|---|---|
| `#overview` | Objective (TSR / ΔTSR), example timeline, ΔTSR map, definitions, scenarios | `/meta`, `/simulations`, `/recovery-matrix`, `/districts` |
| `#simulator` | District, disease, scenario and reporting-completeness (mask) selectors, guided demo, KPI cards, cases vs threshold with gaps for masked months, recovery timeline, rainfall and temperature | `/simulations` |
| `#recovery` | 3D map with layers (recovery result, outbreak peak per 100k, flood exposure, population density) and district-profile hover cards; ΔTSR / interruptions / months-above-threshold matrix; selected series timeline and waves | `/recovery-matrix`, `/districts`, `/simulations` |
| `#episodes` | Outbreak episodes 2015–2024: totals, bar charts by scenario, matched ΔTSR, district table, episode timeline, sensitivity, live unit tests | `/analytics/episodes` |
| `#explorer` | Data audit and catalog, trajectories, seasonality, climate seasonality, lag-correlation table, all-scenario cases and climate with change tables | `/analytics/data-audit`, `/analytics/eda` |
| `#models` | Forecast benchmarks: KPIs, actual vs model chart with toggles and outbreak shading, outbreak vs other MAE, random-forest importance, comparison table, every-district summary | `/analytics/forecasts`, `/analytics/forecast-summary` |
| `#validation` | Estimated vs true TSR, missing-data tests, p10–p90 spread, recovery-rule sensitivity (analyst, admin) | `/validation` |
| `#report` | Scenario report: Export report (PDF), print, JSON, CSV, copy summary | `/simulations`, `POST /exports` |
| `#technology` | Technologies used; Export PDF of the whole project | all, `POST /exports` |
| `#platform` | End users, SaaS model, security, roles, session; admin: verify files on the server, run validation scripts, re-check website files in the browser, audit log | `/integrity`, `/integrity/verify`, `/integrity/validate`, `/audit-log` |

## Sign-in

The app opens on the sign-in screen; `/meta` and everything else are loaded only after sign-in.
`js/auth.js` posts to `/auth/login`, keeps the JWT in `sessionStorage` (this tab only), picks up the
renewed token from the `X-Session-Token` response header, refreshes through `/auth/me` while you are
active but not calling the API, and signs out after 15 idle minutes or when the token expires.
A 401 from any endpoint clears the cache and returns to sign-in. Sign-out calls `/auth/logout`.
Demo accounts: see the repository README.

## Exports

Every export (scenario PDF, project PDF, JSON, CSV, print) first calls `POST /exports`. The server checks the
role and logs the request; if it answers 403 the export does not start. PDFs are built in the browser with jsPDF.

## The frontend computes nothing

TSR, ΔTSR (including censored lower bounds), recovery months, wave onsets, validation metrics, episode
statistics, correlations and model errors all come from the API. Masked months arrive as `null` and are
drawn as gaps. If a field is missing the UI shows "Not provided by the API" instead of working it out.

## Files

```
index.html               app shell (top bar, synthetic-data strip, ten-screen nav, footer)
css/app.css              design tokens (light and dark, categorical --c1..--c7), layout, components, print styles
js/config.js             API base, timeout, default selection (incl. mask), demo sequence
js/api.js                the only data client; contract and synthetic-flag checks, export pre-check
js/auth.js               sign-in, token handling, keep-alive, idle timeout
js/app.js                boot (sign-in first, then /meta), routing
js/state.js              shared district/disease/scenario/mask selection
js/format.js             display formatting (no recovery logic)
js/charts.js             SVG time chart (month or Jan–Dec axes), grouped bar chart, recovery timeline, scatter
js/ui.js                 selectors, KPI cards, composed simulation view, tables
js/screens/*.js          the ten screens plus sign-in
js/map3d.js              3D map of Tamil Nadu's real districts (Three.js) with 2D fallback, map layers, profile cards
js/pdf.js                project summary and scenario report PDFs (jsPDF)
js/tech.js               technology list shared by screen 9 and the PDF
js/assistant.js          rule-based assistant (no AI service)
js/platform-data.js      end users, roles, permissions, security measures, SaaS model
js/theme.js              Day / Night mode
data/geo/tamil_nadu.json Census 2011 district boundaries, DataMeet (CC BY 4.0), simplified
vendor/                  Three.js r149, jsPDF 2.5.1, jsPDF-AutoTable 3.8.2 (MIT licences included)
tools/build_geo.py       builds data/geo/tamil_nadu.json from DataMeet GeoJSON (only if boundaries change)
API_CONTRACT.md          the API schema
```

After changing any file here, rebuild the checksum manifest last: `python -m backend.manage manifest`.
Otherwise the admin integrity checks report the file as changed.

## Accessibility and responsiveness

- Works from 360 px phones to wide desktops; the screen nav becomes tabs on small screens.
- Day and Night themes; categorical colours are validated for colour-vision deficiency in both, and every
  chart has a legend, hover tooltips and a table view.
- Keyboard navigable with visible focus; motion stops when the device asks for reduced motion.

## Credits

District and state boundaries: Census 2011, [DataMeet India community](https://github.com/datameet/maps), CC BY 4.0, simplified.
Three.js, jsPDF and jsPDF-AutoTable under the MIT licence (see `vendor/`).
