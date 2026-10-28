// Screen 1: project overview and explanation.
import { CONFIG } from "../config.js";
import { api } from "../api.js";
import { esc, monthLabel, byId, tsrText, deltaText, plural, disclaimerBody } from "../format.js";
import { recoveryTrack } from "../charts.js";
import { trackLegendHTML, COLORS, errorHTML } from "../ui.js";
import { createDistrictMap, mapValuesFromCells } from "../map3d.js";
import { setSelection } from "../state.js";

export async function render(view, { meta }) {
  const ex = CONFIG.DEFAULT_SELECTION;
  const exScen = byId(meta.scenarios, ex.scenario);
  const exDist = byId(meta.districts, ex.district);
  const exDis = byId(meta.diseases, ex.disease);
  const nMonths = (() => { const [a, b] = [meta.horizon.start_month, meta.horizon.end_month].map((m) => m.split("-").map(Number)); return (b[0] - a[0]) * 12 + (b[1] - a[1]) + 1; })();
  view.innerHTML = `
    <section class="hero">
      <div class="panel stack" style="gap:14px">
        <p class="eyebrow">Screen 1 · Overview · UKM project</p>
        <h1>EpiMetrics-Climate</h1>
        <p class="question">When the climate shifts, how much longer does a district take to recover from a seasonal outbreak?</p>
        <p style="max-width:62ch">The simulator measures <b>Time to Sustained Recovery (TSR)</b> after an outbreak peak, and the <b>recovery delay (ΔTSR)</b> a climate scenario causes compared with the baseline climate. It looks closely at secondary waves that interrupt recovery. Case counts are the route to that answer, not the answer itself.</p>
        <div class="formula" aria-label="Recovery delay equals T S R under the scenario minus T S R under the baseline">ΔTSR = TSR(scenario) − TSR(baseline)</div>
        <div class="row"><a class="btn btn-primary" href="#simulator">Open the scenario simulator</a><a class="btn" href="#validation">See validation and limits</a></div>
      </div>
      <div class="panel stack" style="gap:10px">
        <div class="panel-head" style="margin:0"><h2>Recovery delay by district</h2><span class="small">${esc(exDis?.name)} · ${esc(exScen?.label)} vs baseline</span></div>
        <div id="ov-map"></div>
        <p class="small">Pillar height is the extra months to recover (ΔTSR) from the API. Select a district to open it in the simulator.</p>
      </div>
    </section>

    <section class="panel stack">
      <div class="panel-head" style="margin:0"><h2>Example recovery timeline</h2><span class="small">${esc(exDis?.name)} · ${esc(exDist?.name)} · ${esc(exScen?.label)}</span></div>
      <div id="ov-example" aria-live="polite"><div class="skeleton" style="height:120px"></div></div>
      ${trackLegendHTML()}
      <p class="small" id="ov-example-text"></p>
    </section>

    <section class="callout callout-warn" role="note"><b>Synthetic data, research demonstration only.</b> ${esc(disclaimerBody(meta))}</section>

    <section class="panel">
      <div class="panel-head"><h2>What this project is, and is not</h2></div>
      <div class="is-isnt">
        <div><h3 style="color:var(--good)">It is</h3><ul>
          <li>A controlled simulation with known ground truth</li>
          <li>A measure of recovery time (TSR) and recovery delay (ΔTSR)</li>
          <li>A detector of secondary waves that interrupt recovery</li>
          <li>A test of whether recovery can be estimated from noisy, incomplete case data</li></ul></div>
        <div><h3 style="color:var(--crit)">It is not</h3><ul>
          <li>A case-count forecasting dashboard</li>
          <li>A prediction for real Tamil Nadu districts or real climate</li>
          <li>Evidence of how dengue or malaria truly respond to climate</li>
          <li>Clinical advice or a public-health alert system</li></ul></div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>How to use the simulator</h2></div>
      <ol class="steps">
        <li><b>Choose a series</b><span class="small">One of ${meta.districts.length} districts and ${meta.diseases.length} diseases.</span></li>
        <li><b>Switch the climate</b><span class="small">Move from the baseline to one of ${meta.scenarios.length - 1} climate-altered scenarios.</span></li>
        <li><b>Read recovery</b><span class="small">TSR, ΔTSR, interruptions and status, with the case curves behind them.</span></li>
        <li><b>Check reliability</b><span class="small">Compare estimates with ground truth, and export a report.</span></li>
      </ol>
    </section>

    <section class="grid cols-2">
      <div class="panel">
        <div class="panel-head"><h2>Study design</h2></div>
        <dl class="dl">
          <dt>Districts</dt><dd>${meta.districts.map((d) => `${esc(d.name)} (${esc(d.climate_zone)})`).join(", ")}. Populations and climatologies are illustrative.</dd>
          <dt>Diseases</dt><dd>${meta.diseases.map((d) => `${esc(d.name)} (${esc(d.vector)})`).join(", ")}</dd>
          <dt>Period</dt><dd>${monthLabel(meta.horizon.start_month)} – ${monthLabel(meta.horizon.end_month)}, ${nMonths} months. Thresholds use ${monthLabel(meta.training_period.start_month)} – ${monthLabel(meta.training_period.end_month)}.</dd>
          <dt>Reference peak</dt><dd>A seeded outbreak in every series. Its baseline peak (t0) falls in ${monthLabel(meta.peak_search_window.start_month)} – ${monthLabel(meta.peak_search_window.end_month)}.</dd>
          <dt>Fair comparison</dt><dd>All scenarios share the same random draws (seed ${esc(meta.seed)}), so differences come only from the climate.</dd>
          <dt>Uncertainty</dt><dd>Recovery is re-estimated over ${esc(meta.replicates)} observation-noise replicates.</dd>
        </dl>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Definitions</h2><span class="small">Project conventions, not epidemiological standards</span></div>
        <dl class="dl">
          <dt>Endemic threshold</dt><dd>${esc(meta.recovery_rule.threshold_definition)}</dd>
          <dt>TSR</dt><dd>${esc(meta.recovery_rule.tsr_definition)}</dd>
          <dt>ΔTSR</dt><dd>TSR under the scenario minus TSR under the baseline climate</dd>
          <dt>Secondary wave</dt><dd>${esc(meta.recovery_rule.interruption_definition)}</dd>
          <dt>Censored</dt><dd>No sustained recovery before ${monthLabel(meta.horizon.end_month)}. TSR is then a lower bound, never an invented date.</dd>
          <dt>Insufficient data</dt><dd>More than ${Math.round(meta.recovery_rule.max_missing_frac * 100)}% of months after t0 are missing.</dd>
        </dl>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>The seven climate scenarios</h2><span class="small">Hypothetical inputs, applied to all districts</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Scenario</th><th>Type</th><th>What changes</th></tr></thead>
        <tbody>${meta.scenarios.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td>${esc(s.category)}</td><td>${esc(s.description)}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>

    <section class="grid cols-2">
      <div class="panel"><div class="panel-head"><h2>Assumed climate drivers</h2><span class="small">Marked "to be sourced"</span></div>
        ${meta.diseases.map((d) => `<p style="margin-top:6px"><b>${esc(d.name)}</b></p><ul class="plain small">${d.drivers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}
      </div>
      <div class="panel"><div class="panel-head"><h2>Intended users</h2></div>
        <ul class="plain small">
          <li><b>Public health authorities:</b> explore possible recovery delays and plan for recurring waves.</li>
          <li><b>Healthcare capacity planners:</b> see how long surge periods could last after extreme climate events.</li>
          <li><b>Disaster management agencies:</b> weigh epidemic risk alongside flood and heatwave response.</li>
          <li><b>Epidemiological researchers:</b> test disease parameters and perturbation models.</li>
        </ul>
        <p class="small" style="margin-top:10px">For exploring scenarios only, not for operational decisions.</p>
      </div>
    </section>`;

  let map = null;
  const mapReady = (async () => {
    try {
      const host = view.querySelector("#ov-map");
      const [m, matrix] = await Promise.all([
        createDistrictMap(host, meta.districts, { compact: true, onSelect: (id) => { setSelection({ ...ex, district: id }); location.hash = "simulator"; } }),
        api.recoveryMatrix({ disease: ex.disease }),
      ]);
      map = m;
      m.update(mapValuesFromCells(matrix.cells, ex.scenario, "delta"), ex.district);
      return m;
    } catch (err) {
      const host = view.querySelector("#ov-map");
      if (host) host.innerHTML = errorHTML(err);
      return null;
    }
  })();
  const cleanup = () => mapReady.then((m) => m?.dispose());

  try {
    const sim = await api.simulation(ex);
    const host = view.querySelector("#ov-example");
    if (!host) return cleanup;
    host.innerHTML = "";
    recoveryTrack(host, {
      months: sim.months, range: [sim.months.indexOf(CONFIG.FOCUS_RANGE.start), sim.months.length - 1], t0: sim.reference.t0_month, horizonEnd: meta.horizon.end_month,
      rows: [{ label: "Baseline", color: COLORS.baseline, block: sim.recovery.baseline, waves: sim.waves.baseline },
        { label: exScen?.label || "Scenario", color: COLORS.scenario, block: sim.recovery.scenario, waves: sim.waves.scenario }],
      ariaLabel: "Example recovery timeline, baseline versus scenario",
    });
    const b = tsrText(sim.recovery.baseline, meta.horizon.end_month), s = tsrText(sim.recovery.scenario, meta.horizon.end_month), d = deltaText(sim.recovery);
    view.querySelector("#ov-example-text").innerHTML = `Baseline recovery takes ${esc(b.value)} ${esc(b.unit)}. Under the ${esc(exScen?.label.toLowerCase())} it takes ${esc(s.value)} ${esc(s.unit)}, a delay of <b>${esc(d.value)} ${esc(d.unit)}</b>, with ${plural(sim.recovery.scenario.interruption_count, "interrupting wave")}. Values come from the API.`;
  } catch (err) {
    const host = view.querySelector("#ov-example");
    if (host) host.innerHTML = errorHTML(err);
  }
  return cleanup;
}
