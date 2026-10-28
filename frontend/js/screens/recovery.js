// Screen 3: recovery and recurrence analysis across scenarios and districts.
import { api } from "../api.js";
import { getSelection, setSelection, onSelection } from "../state.js";
import { esc, monthLabel, byId, fmtInt, statusPill, tsrText, plural } from "../format.js";
import { recoveryTrack } from "../charts.js";
import { trackLegendHTML, wavesTableHTML, loadingHTML, errorHTML, COLORS } from "../ui.js";
import { CONFIG } from "../config.js";
import { createDistrictMap, mapValuesFromCells } from "../map3d.js";

const METRICS = {
  delta: { label: "Recovery delay (ΔTSR)", unit: "months vs baseline" },
  interruptions: { label: "Interruptions", unit: "secondary waves before recovery" },
  above: { label: "Months above threshold", unit: "after t0" },
};

// Colour bins for display only; the values themselves come from the API.
function deltaBin(v) {
  if (v == null) return "d-na";
  if (v <= -4) return "d-n3"; if (v <= -2) return "d-n2"; if (v < 0) return "d-n1"; if (v === 0) return "d-0";
  if (v <= 2) return "d-p1"; if (v <= 5) return "d-p2"; if (v <= 9) return "d-p3"; return "d-p4";
}
function countBin(v, cuts) {
  if (v == null) return "d-na";
  if (v <= cuts[0]) return "d-0"; if (v <= cuts[1]) return "d-p1"; if (v <= cuts[2]) return "d-p2"; if (v <= cuts[3]) return "d-p3"; return "d-p4";
}

function cellView(c, metric) {
  if (metric === "delta") {
    if (c.delta_status === "computed") return { v: c.delta_tsr_months > 0 ? `+${c.delta_tsr_months}` : String(c.delta_tsr_months), s: c.scenario === "baseline" ? "reference" : `TSR ${c.tsr_months} mo`, cls: deltaBin(c.delta_tsr_months), censored: false };
    if (c.delta_status === "lower_bound") return { v: `≥ +${c.delta_tsr_lower_bound_months}`, s: "not recovered", cls: deltaBin(c.delta_tsr_lower_bound_months), censored: true };
    return { v: "—", s: c.status === "insufficient_data" ? "insufficient data" : "undefined", cls: "d-na", censored: false };
  }
  if (metric === "interruptions") return { v: String(c.interruption_count), s: c.status === "recovered" ? "before recovery" : "no recovery", cls: countBin(c.interruption_count, [0, 1, 2, 3]), censored: c.status === "not_recovered_within_horizon" };
  return { v: String(c.months_above_threshold), s: "months", cls: countBin(c.months_above_threshold, [2, 5, 8, 12]), censored: c.status === "not_recovered_within_horizon" };
}

export async function render(view, { meta }) {
  let metric = "delta";
  let seq = 0;
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Screen 3 · Recovery &amp; recurrence</p>
        <h1>Which climates delay recovery, and where?</h1>
        <p class="lede">Every scenario and district for one disease. Choose a cell to see its recovery timeline and the secondary waves behind it.</p>
      </div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2 id="rec-map-title">District map</h2><span class="small" id="rec-map-sub"></span></div>
      <div id="rec-map"></div>
      <p class="small" style="margin-top:8px">The five study districts are raised and coloured by the measure chosen below for the selected scenario; pole height shows the same value. Teal means faster than baseline. A pulsing amber tip marks a series that never recovered. Select a pole, a district or a name to choose a district.</p>
    </section>
    <section class="panel stack">
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <div class="field"><label for="rec-disease">Disease</label><select id="rec-disease">${meta.diseases.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}</select></div>
        <div class="field"><span class="label" id="rec-metric-label">Show</span>
          <div class="seg" role="group" aria-labelledby="rec-metric-label">${Object.entries(METRICS).map(([k, m]) => `<button type="button" data-metric="${k}" aria-pressed="${k === metric}">${esc(m.label)}</button>`).join("")}</div></div>
      </div>
      <div id="rec-matrix">${loadingHTML()}</div>
    </section>
    <section class="panel" id="rec-detail-panel">
      <div class="panel-head"><h2 id="rec-detail-title">Selected series</h2><a class="btn" href="#simulator">Open in simulator</a></div>
      <div id="rec-detail">${loadingHTML()}</div>
    </section>`;

  const diseaseSel = view.querySelector("#rec-disease");
  diseaseSel.value = getSelection().disease;
  diseaseSel.addEventListener("change", () => setSelection({ disease: diseaseSel.value }));
  view.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => {
    metric = b.dataset.metric;
    view.querySelectorAll("[data-metric]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    drawMatrix().then(updateMap);
  }));

  let matrix = null;
  async function drawMatrix() {
    const s = getSelection();
    const host = view.querySelector("#rec-matrix");
    try {
      matrix = await api.recoveryMatrix({ disease: s.disease });
    } catch (err) { host.innerHTML = errorHTML(err); return; }
    const cells = new Map(matrix.cells.map((c) => [`${c.scenario}|${c.district}`, c]));
    const cols = meta.districts.length;
    const baseTsr = (d) => cells.get(`baseline|${d}`);
    let html = `<div class="heat-wrap"><div class="heat" style="grid-template-columns: minmax(170px, 1.3fr) repeat(${cols}, minmax(86px, 1fr))">`;
    html += `<div class="h-col" style="text-align:left">Scenario</div>`;
    for (const d of meta.districts) {
      const b = baseTsr(d.id);
      html += `<div class="h-col">${esc(d.name)}<br><span style="text-transform:none;letter-spacing:0;font-weight:500">baseline TSR ${b?.baseline_tsr_months ?? "—"} mo</span></div>`;
    }
    for (const sc of meta.scenarios) {
      html += `<div class="h-row">${esc(sc.label)}</div>`;
      for (const d of meta.districts) {
        const c = cells.get(`${sc.id}|${d.id}`);
        if (!c) { html += `<div class="heat-cell d-na"><span class="hv">—</span><span class="hs">not provided</span></div>`; continue; }
        const v = cellView(c, metric);
        const pressed = s.scenario === sc.id && s.district === d.id;
        html += `<button type="button" class="heat-cell ${v.cls} ${v.censored ? "censored" : ""}" data-s="${esc(sc.id)}" data-d="${esc(d.id)}" aria-pressed="${pressed}"
          aria-label="${esc(sc.label)}, ${esc(d.name)}: ${esc(METRICS[metric].label)} ${esc(v.v)}, ${esc(v.s)}"><span class="hv">${esc(v.v)}</span><span class="hs">${esc(v.s)}</span></button>`;
      }
    }
    html += `</div></div>`;
    html += metric === "delta"
      ? `<div class="heat-legend" aria-hidden="true"><span style="margin-right:6px">Faster</span>
          <span class="hl d-n3">≤ −4</span><span class="hl d-n2">−3…−2</span><span class="hl d-n1">−1</span><span class="hl d-0">0</span><span class="hl d-p1">+1…+2</span><span class="hl d-p2">+3…+5</span><span class="hl d-p3">+6…+9</span><span class="hl d-p4">≥ +10</span>
          <span style="margin-left:6px">Slower</span><span class="hl d-p2 censored" style="margin-left:12px;min-width:64px;background-image:repeating-linear-gradient(135deg,transparent 0 6px,rgba(0,0,0,.14) 6px 8px)">hatched</span><span>= never recovered by ${monthLabel(meta.horizon.end_month)}; value is a minimum</span></div>`
      : `<div class="heat-legend" aria-hidden="true"><span>Lighter = fewer ${metric === "interruptions" ? "interruptions" : "months"}. Hatched = never recovered by ${monthLabel(meta.horizon.end_month)}.</span></div>`;
    html += `<p class="small" style="margin-top:8px">Estimated from observed (noisy) cases with the default rule. Negative delays occur where the assumed temperature optimum is below the district's temperature; they reflect the model's assumptions.</p>`;
    host.innerHTML = html;
    host.querySelectorAll(".heat-cell[data-s]").forEach((b) => b.addEventListener("click", () => setSelection({ scenario: b.dataset.s, district: b.dataset.d })));
  }

  async function drawDetail() {
    const my = ++seq;
    const s = getSelection();
    const host = view.querySelector("#rec-detail");
    const scen = byId(meta.scenarios, s.scenario), dist = byId(meta.districts, s.district), dis = byId(meta.diseases, s.disease);
    view.querySelector("#rec-detail-title").textContent = `${scen?.label} · ${dist?.name} · ${dis?.name}`;
    try {
      const sim = await api.simulation(s);
      if (my !== seq) return;
      const rec = sim.recovery;
      const end = meta.horizon.end_month;
      const t = tsrText(rec.scenario, end);
      host.innerHTML = `
        <div class="grid cols-4" style="margin-bottom:14px">
          <div><div class="kpi-label">TSR</div><div class="num" style="font-size:1.4rem;font-weight:600">${esc(t.value)} <span class="small">${esc(t.unit)}</span></div></div>
          <div><div class="kpi-label">Status</div>${statusPill(rec.scenario.status)}</div>
          <div><div class="kpi-label">Interruptions</div><div class="num" style="font-size:1.4rem;font-weight:600">${fmtInt(rec.scenario.interruption_count)}</div><div class="small">${plural(rec.scenario.secondary_outbreak_count, "wave")} after t0 in total</div></div>
          <div><div class="kpi-label">Months above threshold</div><div class="num" style="font-size:1.4rem;font-weight:600">${fmtInt(rec.scenario.months_above_threshold)}</div><div class="small">from t0 to recovery or horizon</div></div>
        </div>
        <div id="rec-track"></div>${trackLegendHTML()}
        <h3 style="font-size:var(--fs-md);margin:18px 0 8px">Secondary waves</h3>
        ${wavesTableHTML(sim, meta)}`;
      const isBase = s.scenario === "baseline";
      recoveryTrack(host.querySelector("#rec-track"), {
        months: sim.months, range: [sim.months.indexOf(CONFIG.FOCUS_RANGE.start), sim.months.length - 1], t0: sim.reference.t0_month, horizonEnd: end,
        rows: isBase ? [{ label: "Baseline", color: COLORS.baseline, block: rec.baseline, waves: sim.waves.baseline }]
          : [{ label: "Baseline", color: COLORS.baseline, block: rec.baseline, waves: sim.waves.baseline }, { label: scen.label, color: COLORS.scenario, block: rec.scenario, waves: sim.waves.scenario }],
        ariaLabel: "Recovery timeline for the selected series",
      });
    } catch (err) { if (my === seq) host.innerHTML = errorHTML(err); }
  }

  let map = null;
  function updateMap() {
    if (!map || !matrix) return;
    const s = getSelection();
    const scen = byId(meta.scenarios, s.scenario), dis = byId(meta.diseases, s.disease);
    const mv = mapValuesFromCells(matrix.cells, s.scenario, metric);
    map.update(mv.values, s.district, mv.legend);
    view.querySelector("#rec-map-title").textContent = `District map · ${scen?.label}`;
    view.querySelector("#rec-map-sub").textContent = `${dis?.name} · ${METRICS[metric].label}${s.scenario === "baseline" && metric === "delta" ? " (baseline shows TSR)" : ""}`;
  }
  const mapReady = createDistrictMap(view.querySelector("#rec-map"), meta.districts, { onSelect: (id) => setSelection({ district: id }) })
    .then((m) => { map = m; updateMap(); return m; })
    .catch((err) => { view.querySelector("#rec-map").innerHTML = errorHTML(err); });

  let lastDisease = null;
  const update = async () => {
    const s = getSelection();
    diseaseSel.value = s.disease;
    if (s.disease !== lastDisease || !matrix) { lastDisease = s.disease; await drawMatrix(); }
    else view.querySelectorAll(".heat-cell[data-s]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.s === s.scenario && b.dataset.d === s.district)));
    updateMap();
    await drawDetail();
  };
  const off = onSelection(update);
  await update();
  return () => { off(); mapReady.then((m) => m?.dispose()); };
}
