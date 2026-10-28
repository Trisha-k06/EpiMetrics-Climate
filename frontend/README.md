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

## Screens per role

The menu is built from `GET /auth/me`, which returns the role's screens from `backend/roles.py`. A screen that is
not in the list shows "This screen isn't part of your account". Screens load on demand (dynamic `import()`).

| Role | Home | Screens |
|---|---|---|
| Young Minds (`junior`) | Explore | `#young-explore`, `#young-lab`, `#young-quiz`, `#young-glossary` (separate shell in `js/young/`) |
| Viewer | Overview | `#overview`, `#simulator` (simple mode), `#map`, `#compare` (simple), `#report` |
| Analyst | Overview | `#overview`, `#simulator`, `#recovery`, `#compare`, `#episodes`, `#explorer`, `#models`, `#validation`, `#report`, `#technology`, `#platform` |
| Admin | Admin console | `#admin` (usage, users, audit, integrity, backups, comments, view as), `#platform`, `#technology` |

Every screen follows the same order: question title, answer card, chart, details. Advanced options (mask, time
range, rule) sit in an "Advanced options" disclosure; each metric has an "i" tooltip whose wording comes from
`js/glossary.js`, shared with the assistant and the PDFs.

## Sign-in

The app opens on the sign-in screen; `/meta` and everything else are loaded only after sign-in.
`js/auth.js` posts to `/auth/login`, keeps the JWT, the role's screens and permissions in `sessionStorage` (this tab
only), picks up the renewed token from `X-Session-Token`, refreshes through `/auth/me` while you are active, and signs
out after 15 idle minutes, when the token expires, or when an admin changes the account (`session_changed`).
An admin can preview another role read-only: the browser then sends `X-View-As` and the server refuses writes.

## Exports

Every export (scenario PDF, project PDF, JSON, CSV, print) first calls `POST /exports`. The server checks the
role and logs the request; if it answers 403 the export does not start. On the Scenario report, all exports the
role may use sit in one "Export report ▾" menu, with an option to include team comments in the PDF. PDFs are built
in the browser with jsPDF; characters its font cannot draw (emoji, Tamil script) are replaced by a visible `[?]`.

## Saved views, comments and usage

Saved views, favourite districts and team comments are stored on the server (SQLite), never only in the browser.
Comments are plain text (always inserted with `textContent` / escaping). The UI sends `POST /events` on screen opens
and major actions (debounced, no free text) for the admin usage dashboard and the recommended insights.

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
js/screens/*.js          the screens plus sign-in (admin.js, compare.js, map.js are new)
js/components/           tooltip, menu, breadcrumbs, comments, saved views, insights, drill-down
js/young/                Young Minds shell and original SVG art
js/glossary.js           plain-language definitions shared by tooltips, assistant and PDFs
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
