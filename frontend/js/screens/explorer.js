// Screen 5: data explorer (notebooks 01–02). Audit checks, trajectories, seasonality, climate seasonality,
// lag correlations and the 2022–2024 scenario period, all from GET /analytics/data-audit and /analytics/eda.
import { api } from "../api.js";
import { getSelection, setSelection, onSelection } from "../state.js";
import { esc, byId, fmtInt, fmtNum, fmtSigned } from "../format.js";
import { timeChart, seriesLegendHTML } from "../charts.js";
import { selectorsHTML, bindSelects, loadingHTML, errorHTML, CAT, DISEASE_COLORS, passPill, screenEyebrow } from "../ui.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VARS = [
  { id: "rainfall_mm", label: "Rainfall", unit: "mm", nd: 0 },
  { id: "mean_temperature_c", label: "Mean temperature", unit: "°C", nd: 1 },
  { id: "relative_humidity_pct", label: "Relative humidity", unit: "%", nd: 1 },
];

export async function render(view, { meta }) {
  let seq = 0;
  let climVar = "rainfall_mm";
  const scenLabel = (id) => byId(meta.scenarios, id)?.label || id;
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${screenEyebrow("explorer", "Data explorer")}</p>
        <h1>What does the synthetic dataset look like?</h1>
        <p class="lede">The checks and first look from notebooks 01 and 02: is the data complete and consistent, how do cases and climate move through the year, and what each climate scenario changes in 2022–2024.</p>
      </div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Data audit</h2><span class="small">Notebook 01, recomputed by the server from the CSV files</span></div>
      <div id="ex-audit">${loadingHTML("Checking the dataset…")}</div>
    </section>
    <section class="panel stack">
      <div class="row" style="justify-content:space-between;align-items:flex-end">${selectorsHTML(meta, getSelection(), { idPrefix: "ex" })}
        <p class="small" style="max-width:52ch">Baseline climate and training years (2015–2021) unless a chart says otherwise. All values are synthetic.</p></div>
      <div><h2 class="h3" id="ex-traj-title">Baseline trajectories</h2><div id="ex-traj"></div></div>
    </section>
    <section class="grid cols-2">
      <div class="panel"><div class="panel-head"><h2 id="ex-seas-title">Disease seasonality</h2><span class="small">Mean cases per 100,000 by calendar month, 2015–2021</span></div><div id="ex-seas"></div></div>
      <div class="panel"><div class="panel-head"><h2 id="ex-clim-title">Climate seasonality</h2><span class="small">Monthly means, 2015–2021</span></div><div id="ex-clim"></div></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Climate–case correlations by lag</h2><span class="small">Pooled over all five districts, baseline, 2015–2021 · Pearson r between cases per 100,000 and climate 0–3 months earlier</span></div>
      <div id="ex-corr"></div>
    </section>
    <section class="panel stack">
      <div class="panel-head" style="margin:0"><h2 id="ex-scen-title">The scenario period, 2022–2024</h2><span class="small">All seven scenarios for the selected district</span></div>
      <div><h3 class="h3">Cases per 100,000</h3><div id="ex-scen-legend"></div><div id="ex-scen-cases"></div></div>
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <h3 class="h3" style="margin:0">Climate</h3>
        <div class="seg" role="group" aria-label="Climate variable">${VARS.map((v) => `<button type="button" data-var="${v.id}" aria-pressed="${v.id === climVar}">${esc(v.label)}</button>`).join("")}</div>
      </div>
      <div id="ex-scen-clim"></div>
      <div class="grid cols-2">
        <div><h3 class="h3">Case changes vs baseline</h3><div id="ex-case-changes"></div></div>
        <div><h3 class="h3" id="ex-clim-changes-title">Climate changes vs baseline</h3><div id="ex-clim-changes"></div></div>
      </div>
    </section>`;
  bindSelects(view);
  view.querySelectorAll("[data-var]").forEach((b) => b.addEventListener("click", () => {
    climVar = b.dataset.var;
    view.querySelectorAll("[data-var]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (current) drawScenarioClimate(current);
  }));

  api.dataAudit().then((a) => {
    const host = view.querySelector("#ex-audit");
    if (!host) return;
    host.innerHTML = `
      <div class="row" style="margin-bottom:10px">${a.all_pass ? '<span class="pill pill-good">✓ All checks pass</span>' : '<span class="pill pill-crit">Some checks failed</span>'}
        <span class="small">${fmtInt(a.counts.disease_case_rows)} case rows · ${fmtInt(a.counts.climate_rows)} climate rows · ${a.counts.series} series · ${a.counts.months} months</span></div>
      <ul class="check-list">${a.checks.map((c) => `<li>${passPill(c.pass)}<div><b>${esc(c.check)}</b><div class="small">${esc(c.detail)}</div></div></li>`).join("")}</ul>
      <details class="data-table" style="margin-top:10px"><summary>Dataset catalog (${a.catalog.length} tables)</summary>
        <div class="table-wrap scroll-y" style="margin-top:8px"><table><thead><tr><th>Table</th><th>Role</th><th class="n">Rows</th><th class="n">Columns</th><th>Purpose</th></tr></thead><tbody>
        ${a.catalog.map((r) => `<tr><td class="mono small">${esc(r.path)}</td><td>${esc(r.role)}</td><td class="n">${fmtInt(r.rows)}</td><td class="n">${fmtInt(r.columns)}</td><td>${esc(r.purpose)}</td></tr>`).join("")}</tbody></table></div></details>`;
  }).catch((err) => { const host = view.querySelector("#ex-audit"); if (host) host.innerHTML = errorHTML(err); });

  let current = null;
  async function update() {
    const my = ++seq;
    const s = getSelection();
    view.querySelectorAll("select[data-key]").forEach((el) => (el.value = s[el.dataset.key]));
    let d;
    try {
      d = await api.eda({ district: s.district, disease: s.disease });
    } catch (err) {
      if (my === seq) view.querySelector("#ex-traj").innerHTML = errorHTML(err);
      return;
    }
    if (my !== seq) return;
    current = d;
    const dist = byId(meta.districts, s.district), dis = byId(meta.diseases, s.disease);

    view.querySelector("#ex-traj-title").textContent = `Baseline trajectories · ${dist.name}, cases per 100,000`;
    const trajSeries = meta.diseases.map((z) => ({ label: z.name, values: d.trajectories_per_100k[z.id], color: DISEASE_COLORS[z.id] }));
    const traj = view.querySelector("#ex-traj");
    traj.innerHTML = seriesLegendHTML(trajSeries) + '<div class="ex-chart"></div>';
    timeChart(traj.querySelector(".ex-chart"), { months: d.months, range: [0, d.months.length - 1], unit: "Cases per 100k", series: trajSeries,
      valueFmt: (v) => fmtNum(v, 1),
      vlines: [{ month: "2022-01", label: "Test period starts", color: "var(--ink-3)", dash: "4 3", top: true }],
      ariaLabel: `Monthly dengue and malaria cases per 100,000 in ${dist.name}, baseline climate, 2015 to 2024` });

    view.querySelector("#ex-seas-title").textContent = `Disease seasonality · ${dis.name}`;
    const seasSeries = [
      { label: `${dist.name}`, values: d.seasonality_per_100k[s.disease].district, color: DISEASE_COLORS[s.disease] },
      { label: "All five districts", values: d.seasonality_per_100k[s.disease].pooled, color: "var(--ink-3)", dash: "5 4" },
    ];
    const seas = view.querySelector("#ex-seas");
    seas.innerHTML = seriesLegendHTML(seasSeries) + '<div class="ex-chart"></div>';
    timeChart(seas.querySelector(".ex-chart"), { months: MONTHS, categories: MONTHS, range: [0, 11], height: 240, unit: "Cases per 100k", series: seasSeries,
      valueFmt: (v) => fmtNum(v, 2), ariaLabel: `Average ${dis.name} cases per 100,000 by calendar month` });

    view.querySelector("#ex-clim-title").textContent = `Climate seasonality · ${dist.name}`;
    const clim = view.querySelector("#ex-clim");
    clim.innerHTML = VARS.map((v) => `<div class="small" style="font-weight:600;color:var(--ink)">${esc(v.label)} (${esc(v.unit)})</div><div data-cs="${v.id}"></div>`).join("");
    for (const v of VARS) {
      timeChart(clim.querySelector(`[data-cs="${v.id}"]`), { months: MONTHS, categories: MONTHS, range: [0, 11], height: 150, unitShort: v.unit,
        yFloorZero: v.id === "rainfall_mm", series: [{ label: v.label, values: d.climate_seasonality[v.id], color: "var(--c1)" }],
        valueFmt: (x) => fmtNum(x, v.nd), ariaLabel: `${v.label} by calendar month in ${dist.name}` });
    }

    drawCorrelations(d);
    drawScenarioPeriod(d, dist, dis);
  }

  function drawCorrelations(d) {
    const cell = (r) => {
      if (r == null) return '<td class="n">—</td>';
      const a = Math.min(1, Math.abs(r));
      const hue = r >= 0 ? "var(--c2)" : "var(--c1)";
      return `<td class="n corr" style="background:color-mix(in oklab, ${hue} ${Math.round(a * 70)}%, transparent)">${fmtSigned(r, 3)}</td>`;
    };
    view.querySelector("#ex-corr").innerHTML = `<div class="table-wrap"><table class="corr-table"><thead><tr><th>Climate variable</th>${[0, 1, 2, 3].flatMap((l) => meta.diseases.map((z) => `<th class="n">${l === 0 ? "Same month" : `${l}-month lag`}<br>${esc(z.name)}</th>`)).join("")}</tr></thead><tbody>
      ${VARS.map((v) => `<tr><td><b>${esc(v.label)}</b></td>${[0, 1, 2, 3].flatMap((l) => meta.diseases.map((z) => cell(d.lag_correlations.find((r) => r.variable === v.id && r.lag === l)?.[z.id]))).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="heat-legend" aria-hidden="true"><span class="hl" style="background:color-mix(in oklab, var(--c1) 70%, transparent)">−1</span><span class="hl" style="background:transparent;border:1px solid var(--line)">0</span><span class="hl" style="background:color-mix(in oklab, var(--c2) 70%, transparent)">+1</span><span>Stronger colour = stronger correlation. ${esc(d.notes[1])}</span></div>`;
  }

  function drawScenarioPeriod(d, dist, dis) {
    const sp = d.scenario_period;
    view.querySelector("#ex-scen-title").textContent = `The scenario period, 2022–2024 · ${dis.name} in ${dist.name}`;
    const series = meta.scenarios.map((sc, k) => ({ label: sc.label, values: sp.cases_per_100k[sc.id], color: CAT[k], width: sc.id === "baseline" ? 2.5 : 1.6 }));
    view.querySelector("#ex-scen-legend").innerHTML = seriesLegendHTML(series);
    timeChart(view.querySelector("#ex-scen-cases"), { months: sp.months, range: [0, sp.months.length - 1], unit: "Cases per 100k", series,
      valueFmt: (v) => fmtNum(v, 2),
      ariaLabel: `${dis.name} cases per 100,000 in ${dist.name} under all seven climate scenarios, 2022 to 2024` });
    drawScenarioClimate(d);
    view.querySelector("#ex-case-changes").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Scenario</th><th class="n">Months changed</th><th class="n">Largest rise</th><th class="n">Largest fall</th><th class="n">Cumulative</th><th>First change</th></tr></thead><tbody>
      ${d.case_changes.map((r) => `<tr><td>${esc(scenLabel(r.scenario))}</td><td class="n">${r.months_changed}</td><td class="n">${fmtSigned(r.largest_increase_per_100k, 3)}</td><td class="n">${fmtSigned(r.largest_decrease_per_100k, 3)}</td><td class="n">${fmtSigned(r.cumulative_difference_per_100k, 2)}</td><td>${esc(r.first_changed_month || "—")}</td></tr>`).join("")}</tbody></table></div>
      <p class="small" style="margin-top:6px">Cases per 100,000, scenario minus baseline, 2022–2024.</p>`;
  }

  function drawScenarioClimate(d) {
    const sp = d.scenario_period, v = VARS.find((x) => x.id === climVar);
    const series = meta.scenarios.map((sc, k) => ({ label: sc.label, values: sp.climate[climVar][sc.id], color: CAT[k], width: sc.id === "baseline" ? 2.5 : 1.6 }));
    timeChart(view.querySelector("#ex-scen-clim"), { months: sp.months, range: [0, sp.months.length - 1], height: 240, unit: v.unit, unitShort: v.unit,
      yFloorZero: climVar === "rainfall_mm", series, valueFmt: (x) => fmtNum(x, v.nd),
      ariaLabel: `${v.label} under all seven climate scenarios, 2022 to 2024` });
    view.querySelector("#ex-clim-changes-title").textContent = `${v.label} changes vs baseline`;
    view.querySelector("#ex-clim-changes").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Scenario</th><th class="n">Months changed</th><th class="n">Max rise (${esc(v.unit)})</th><th class="n">Max fall (${esc(v.unit)})</th></tr></thead><tbody>
      ${d.climate_changes.filter((r) => r.variable === climVar).map((r) => `<tr><td>${esc(scenLabel(r.scenario))}</td><td class="n">${r.months_changed}</td><td class="n">${fmtSigned(r.max_increase, v.nd || 1)}</td><td class="n">${fmtSigned(r.max_decrease, v.nd || 1)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  const off = onSelection(update);
  await update();
  return off;
}
