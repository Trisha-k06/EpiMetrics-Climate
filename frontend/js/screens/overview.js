// Home for viewers and analysts: the 3D map of Tamil Nadu is the full-bleed hero, with floating glass cards
// (question, today's highlight from /recovery-matrix, three quick starts). Long explanations sit in "Learn more".
import { CONFIG } from "../config.js";
import { api } from "../api.js";
import { can, canOpen } from "../auth.js";
import { esc, monthLabel, byId, tsrText, deltaText, plural, disclaimerBody } from "../format.js";
import { recoveryTrack } from "../charts.js";
import { trackLegendHTML, COLORS, errorHTML } from "../ui.js";
import { createDistrictMap, mapValuesFromCells, districtTip } from "../map3d.js";
import { setSelection, getSelection } from "../state.js";
import { END_USERS } from "../platform-data.js";
import { infoTip } from "../components/tooltip.js";
import { mountSavedPanel } from "../components/saved.js";
import { mountInsights } from "../components/insights.js";

export async function render(view, { meta, access }) {
  const ex = CONFIG.DEFAULT_SELECTION;
  const exScen = byId(meta.scenarios, ex.scenario);
  const advanced = can("advanced");
  const mapScreen = canOpen("recovery") ? "recovery" : "map";
  const nMonths = (() => { const [a, b] = [meta.horizon.start_month, meta.horizon.end_month].map((m) => m.split("-").map(Number)); return (b[0] - a[0]) * 12 + (b[1] - a[1]) + 1; })();
  view.innerHTML = `
    <section class="hero-map" aria-label="Tamil Nadu: recovery delay by study district">
      <div class="hero-map-canvas" id="ov-map"></div>
      <div class="hero-cards">
        <article class="glass hero-card hero-main">
          <p class="eyebrow">EpiMetrics-Climate · ${esc(access.label)}</p>
          <h1>When the climate shifts, how much longer does recovery take?</h1>
          <p>We measure <b>time to sustained recovery</b> ${infoTip("tsr", { label: "time to sustained recovery" })} after an outbreak peak, and the <b>extra months</b> ${infoTip("delta_tsr")} a climate change adds.</p>
          <span class="badge badge-synthetic hero-badge" title="All data in this application is synthetic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>Synthetic data · not a forecast</span>
        </article>
        <article class="glass hero-card hero-highlight" id="ov-highlight" aria-live="polite"><p class="eyebrow">Today's highlight</p><div class="skeleton" style="height:44px"></div></article>
        <nav class="glass hero-card hero-actions" aria-label="Quick start">
          <a class="btn btn-primary" href="#simulator">Explore a scenario</a>
          <a class="btn" href="#compare">Compare two climates</a>
          <a class="btn" href="#${mapScreen}">See the district map</a>
        </nav>
      </div>
    </section>

    <section class="grid cols-2 home-row">
      ${can("saved") ? '<div class="panel"><div class="panel-head"><h2>My saved</h2><span class="small">Views and pinned districts</span></div><div id="ov-saved"></div></div>' : ""}
      <div class="panel" id="ov-insights" hidden></div>
    </section>

    <section class="panel stack">
      <div class="panel-head" style="margin:0"><h2>Example: ${esc(byId(meta.diseases, ex.disease)?.name)} in ${esc(byId(meta.districts, ex.district)?.name)}</h2><span class="small">${esc(exScen?.label)} vs baseline</span></div>
      <p class="answer" id="ov-example-text"></p>
      <div id="ov-example" aria-live="polite"><div class="skeleton" style="height:120px"></div></div>
      ${trackLegendHTML()}
    </section>

    <section class="callout callout-warn" role="note"><b>Synthetic data, research demonstration only.</b> ${esc(disclaimerBody(meta))}</section>

    <details class="panel learn-more">
      <summary><h2>What this project is, and is not</h2><span class="small">Learn more</span></summary>
      <div class="is-isnt" style="margin-top:12px">
        <div><h3 style="color:var(--good)">It is</h3><ul>
          <li>A controlled simulation with known ground truth</li><li>A measure of recovery time (TSR) and recovery delay (ΔTSR)</li>
          <li>A detector of secondary waves that interrupt recovery</li><li>A test of whether recovery can be estimated from noisy, incomplete case data</li></ul></div>
        <div><h3 style="color:var(--crit)">It is not</h3><ul>
          <li>A case-count forecasting dashboard</li><li>A prediction for real Tamil Nadu districts or real climate</li>
          <li>Evidence of how dengue or malaria truly respond to climate</li><li>Clinical advice or a public-health alert system</li></ul></div>
      </div>
    </details>
    ${advanced ? `<details class="panel learn-more">
      <summary><h2>Study design and definitions</h2><span class="small">Learn more</span></summary>
      <div class="grid cols-2" style="margin-top:12px">
        <dl class="dl">
          <dt>Districts</dt><dd>${meta.districts.map((d) => `${esc(d.name)} (${esc(d.climate_zone)})`).join(", ")}. Populations and climatologies are illustrative.</dd>
          <dt>Diseases</dt><dd>${meta.diseases.map((d) => `${esc(d.name)} (${esc(d.vector)})`).join(", ")}</dd>
          <dt>Period</dt><dd>${monthLabel(meta.horizon.start_month)} – ${monthLabel(meta.horizon.end_month)}, ${nMonths} months. Thresholds use ${monthLabel(meta.training_period.start_month)} – ${monthLabel(meta.training_period.end_month)}.</dd>
          <dt>Reference peak</dt><dd>A seeded outbreak in every series; its baseline peak (t0) falls in ${monthLabel(meta.peak_search_window.start_month)} – ${monthLabel(meta.peak_search_window.end_month)}.</dd>
          <dt>Fair comparison</dt><dd>All scenarios share the same random draws (seed ${esc(meta.seed)}), so differences come only from the climate.</dd>
          <dt>Uncertainty</dt><dd>Recovery is re-estimated over ${esc(meta.replicates)} observation-noise replicates.</dd>
        </dl>
        <dl class="dl">
          <dt>Endemic threshold</dt><dd>${esc(meta.recovery_rule.threshold_definition)}</dd>
          <dt>TSR</dt><dd>${esc(meta.recovery_rule.tsr_definition)}</dd>
          <dt>ΔTSR</dt><dd>TSR under the scenario minus TSR under the baseline climate</dd>
          <dt>Secondary wave</dt><dd>${esc(meta.recovery_rule.interruption_definition)}</dd>
          <dt>Censored</dt><dd>No sustained recovery before ${monthLabel(meta.horizon.end_month)}. TSR is then a lower bound, never an invented date.</dd>
          <dt>Insufficient data</dt><dd>More than ${Math.round(meta.recovery_rule.max_missing_frac * 100)}% of months after t0 are missing.</dd>
        </dl>
      </div>
    </details>` : ""}
    <details class="panel learn-more">
      <summary><h2>The seven climate scenarios</h2><span class="small">Hypothetical inputs, applied to all districts</span></summary>
      <div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Scenario</th><th>Type</th><th>What changes</th></tr></thead>
        <tbody>${meta.scenarios.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td>${esc(s.category)}</td><td>${esc(s.description)}</td></tr>`).join("")}</tbody>
      </table></div>
    </details>
    <details class="panel learn-more">
      <summary><h2>Who will use it</h2><span class="small">For planning and research only</span></summary>
      <ul class="plain small" style="margin-top:12px">${END_USERS.map((u) => `<li><b>${esc(u.name)}:</b> ${esc(u.task)}</li>`).join("")}</ul>
      ${advanced ? `<h3 class="h3" style="margin-top:14px">Assumed climate drivers (to be sourced)</h3>${meta.diseases.map((d) => `<p style="margin-top:6px"><b>${esc(d.name)}</b></p><ul class="plain small">${d.drivers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}` : ""}
    </details>`;

  let profiles = [];
  const mapReady = (async () => {
    const host = view.querySelector("#ov-map");
    try {
      const tipFor = (id) => districtTip(profiles.find((d) => d.id === id));
      const [m, matrices, prof] = await Promise.all([
        createDistrictMap(host, meta.districts, { hero: true, shiftX: 1.35, tipFor,
          onSelect: (id) => { setSelection({ district: id }); location.hash = mapScreen; } }),
        Promise.all(meta.diseases.map((d) => api.recoveryMatrix({ disease: d.id }))),
        api.districts(),
      ]);
      profiles = prof.districts;
      const k = meta.diseases.findIndex((d) => d.id === ex.disease);
      const mv = mapValuesFromCells(matrices[k].cells, ex.scenario, "delta");
      m.update(mv.values, getSelection().district, mv.legend);
      drawHighlight(matrices);
      return m;
    } catch (err) {
      if (host.isConnected) host.innerHTML = errorHTML(err);
      view.querySelector("#ov-highlight").innerHTML = errorHTML(err);
      return null;
    }
  })();

  // The largest delay among the API's cells for the default scenario (display only: picking the largest API value).
  function drawHighlight(matrices) {
    const host = view.querySelector("#ov-highlight");
    if (!host) return;
    let best = null;
    matrices.forEach((mx, k) => {
      for (const c of mx.cells) {
        if (c.scenario !== ex.scenario) continue;
        const v = c.delta_status === "computed" ? c.delta_tsr_months : c.delta_status === "lower_bound" ? c.delta_tsr_lower_bound_months : null;
        if (v != null && (!best || v > best.v)) best = { v, c, disease: meta.diseases[k] };
      }
    });
    if (!best) { host.innerHTML = '<p class="eyebrow">Today\'s highlight</p><p>No delay is available for this scenario.</p>'; return; }
    const dist = byId(meta.districts, best.c.district);
    const value = best.c.delta_status === "lower_bound" ? `at least +${best.v}` : `+${best.v}`;
    host.innerHTML = `<p class="eyebrow">Today's highlight</p>
      <p class="highlight-value"><b>${esc(dist.name)} ${esc(best.disease.name.toLowerCase())}: ${esc(value)} months</b></p>
      <p class="small">The largest recovery delay under a ${esc(exScen.label.toLowerCase())}, across the five districts and two diseases (from the API).</p>
      <button type="button" class="btn btn-sm" id="ov-hl-open">Open this result</button>`;
    host.querySelector("#ov-hl-open").addEventListener("click", () => {
      setSelection({ district: best.c.district, disease: best.disease.id, scenario: ex.scenario });
      location.hash = "simulator";
    });
  }

  if (can("saved")) mountSavedPanel(view.querySelector("#ov-saved"), meta);
  mountInsights(view.querySelector("#ov-insights"), getSelection());

  try {
    const sim = await api.simulation(ex);
    const host = view.querySelector("#ov-example");
    if (!host) return () => mapReady.then((m) => m?.dispose());
    host.innerHTML = "";
    recoveryTrack(host, {
      months: sim.months, range: [sim.months.indexOf(CONFIG.FOCUS_RANGE.start), sim.months.length - 1], t0: sim.reference.t0_month, horizonEnd: meta.horizon.end_month,
      rows: [{ label: "Baseline", color: COLORS.baseline, block: sim.recovery.baseline, waves: sim.waves.baseline },
        { label: exScen?.label || "Scenario", color: COLORS.scenario, block: sim.recovery.scenario, waves: sim.waves.scenario }],
      ariaLabel: "Example recovery timeline, baseline versus scenario",
    });
    const b = tsrText(sim.recovery.baseline, meta.horizon.end_month), s = tsrText(sim.recovery.scenario, meta.horizon.end_month), d = deltaText(sim.recovery);
    view.querySelector("#ov-example-text").innerHTML = `Recovery takes <b>${esc(s.value)} ${esc(s.unit)}</b> under a ${esc(exScen?.label.toLowerCase())} instead of ${esc(b.value)}: <b>${esc(d.value)} ${esc(d.unit)}</b> longer, with ${plural(sim.recovery.scenario.interruption_count, "interrupting wave")}.`;
  } catch (err) {
    const host = view.querySelector("#ov-example");
    if (host) host.innerHTML = errorHTML(err);
  }
  return () => mapReady.then((m) => m?.dispose());
}
