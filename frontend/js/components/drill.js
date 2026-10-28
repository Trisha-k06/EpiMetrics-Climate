// District drill-down: Tamil Nadu › district › disease › year › month. Uses only the existing API data
// (/recovery-matrix for the scenario list, /simulations for the chart and the month details). No sub-district data.
import { api, track } from "../api.js";
import { esc, byId, monthLabel, tsrText, deltaText } from "../format.js";
import { getSelection, setSelection } from "../state.js";
import { timeChart } from "../charts.js";
import { COLORS, errorHTML, loadingHTML, monthDetailHTML, gapRuns } from "../ui.js";
import { CONFIG } from "../config.js";
import { crumbsHTML, bindCrumbs } from "./breadcrumbs.js";
import { infoTip } from "./tooltip.js";

/** host: element · returns { show(district) } — call show() when a district is chosen on the map or grid. */
export function mountDrill(host, meta, { mask = () => "none", onTop, initialDistrict = null } = {}) {
  let state = { district: initialDistrict, disease: getSelection().disease, scenario: getSelection().scenario, year: null, month: null };
  let seq = 0;
  host.classList.add("drill");

  async function draw() {
    const my = ++seq;
    const s = state;
    if (!s.district) { host.innerHTML = '<p class="small">Select a district on the map (or its label) to open its panel.</p>'; return; }
    const dist = byId(meta.districts, s.district), dis = byId(meta.diseases, s.disease);
    const crumbs = [{ label: "Tamil Nadu", onClick: () => { state = { ...state, district: null, month: null, year: null }; onTop?.(); draw(); } },
      { label: dist.name, onClick: () => { state = { ...state, month: null, year: null }; draw(); } },
      { label: dis.name, onClick: () => { state = { ...state, month: null, year: null }; draw(); } }];
    if (s.year) crumbs.push({ label: s.year, onClick: () => { state = { ...state, month: null }; draw(); } });
    if (s.month) crumbs.push({ label: monthLabel(s.month) });
    host.innerHTML = `${crumbsHTML(crumbs)}
      <div class="panel-head"><h2>${esc(dist.name)} · ${esc(dis.name)}</h2>
        <div class="seg" role="group" aria-label="Disease">${meta.diseases.map((d) => `<button type="button" data-dis="${esc(d.id)}" aria-pressed="${d.id === s.disease}">${esc(d.name)}</button>`).join("")}</div></div>
      <div class="drill-body">${loadingHTML()}</div>`;
    bindCrumbs(host, crumbs);
    host.querySelectorAll("[data-dis]").forEach((b) => b.addEventListener("click", () => { state = { ...state, disease: b.dataset.dis, month: null, year: null }; setSelection({ disease: b.dataset.dis }); draw(); }));
    const body = host.querySelector(".drill-body");
    try {
      const [mx, sim] = await Promise.all([api.recoveryMatrix({ disease: s.disease, mask: mask() }),
        api.simulation({ district: s.district, disease: s.disease, scenario: s.scenario, mask: mask() })]);
      if (my !== seq) return;
      const cells = mx.cells.filter((c) => c.district === s.district);
      const end = meta.horizon.end_month;
      const fmt = (c) => (c.scenario === "baseline" ? `${c.tsr_months ?? "—"} months` : c.delta_status === "computed" ? `${c.delta_tsr_months > 0 ? "+" : ""}${c.delta_tsr_months} months` : c.delta_status === "lower_bound" ? `≥ +${c.delta_tsr_lower_bound_months} months` : "n/a");
      body.innerHTML = `<div class="drill-grid">
        <div><h3 class="h3">Climate scenarios ${infoTip("delta_tsr")}</h3>
          <ul class="scen-list">${meta.scenarios.map((sc) => { const c = cells.find((x) => x.scenario === sc.id);
            return `<li><button type="button" data-scen="${esc(sc.id)}" aria-pressed="${sc.id === s.scenario}"><span>${esc(sc.label)}</span><b>${esc(c ? fmt(c) : "—")}</b></button></li>`; }).join("")}</ul>
          <p class="small">Baseline row: months to recover. Other rows: extra months compared with the baseline.</p></div>
        <div><h3 class="h3">${esc(byId(meta.scenarios, s.scenario).label)}: cases by month</h3>
          <p class="small">${esc(tsrText(sim.recovery.scenario, end).value)} ${esc(tsrText(sim.recovery.scenario, end).unit)} to recover · ${s.scenario === "baseline" ? "baseline" : esc(deltaText(sim.recovery).value) + " vs baseline"}. Select a year, then a month.</p>
          <div class="seg seg-wrap" role="group" aria-label="Year">${[...new Set(sim.months.map((m) => m.slice(0, 4)))].filter((y) => y >= CONFIG.FOCUS_RANGE.start.slice(0, 4)).map((y) => `<button type="button" data-year="${y}" aria-pressed="${y === s.year}">${y}</button>`).join("")}</div>
          <div class="drill-chart"></div>
          ${s.month ? `<div class="drill-month"><h3 class="h3">${esc(monthLabel(s.month))}</h3>${monthDetailHTML(sim, s.month, meta)}</div>` : ""}
        </div></div>`;
      body.querySelectorAll("[data-scen]").forEach((b) => b.addEventListener("click", () => { state = { ...state, scenario: b.dataset.scen, month: null }; setSelection({ scenario: b.dataset.scen }); draw(); }));
      body.querySelectorAll("[data-year]").forEach((b) => b.addEventListener("click", () => { state = { ...state, year: b.dataset.year, month: null }; draw(); }));
      const months = sim.months;
      const i0 = s.year ? months.indexOf(`${s.year}-01`) : months.indexOf(CONFIG.FOCUS_RANGE.start);
      const i1 = s.year ? months.indexOf(`${s.year}-12`) : months.length - 1;
      const series = [{ label: "Baseline cases", values: sim.series.baseline.observed_cases, color: COLORS.baseline }];
      if (s.scenario !== "baseline") series.push({ label: "Scenario cases", values: sim.series.scenario.observed_cases, color: COLORS.scenario });
      const gaps = gapRuns(months, sim.series.baseline.observed_cases, sim.series.scenario.observed_cases);
      timeChart(body.querySelector(".drill-chart"), {
        months, range: [i0, i1], height: 220, unit: "Cases / month", series,
        steps: { label: "Threshold", values: sim.threshold_cases, color: COLORS.threshold },
        bands: [...sim.anomaly_windows.map((a) => ({ start: a.start_month, end: a.end_month, label: "" })),
          ...gaps.map((g) => ({ start: g.start, end: g.end, fill: "var(--gap)", stroke: "var(--ink-3)" }))],
        vlines: s.month ? [{ month: s.month, label: monthLabel(s.month, "short"), color: "var(--accent)", top: true }] : [],
        onPick: (m) => { state = { ...state, year: m.slice(0, 4), month: m }; track("drilldown", { screen: "map", district: s.district, disease: s.disease, scenario: s.scenario }); draw(); },
        ariaLabel: `Monthly ${dis.name} cases in ${dist.name}${s.year ? ` in ${s.year}` : ""}, baseline versus scenario, with the threshold`,
      });
    } catch (err) {
      if (my === seq) body.innerHTML = errorHTML(err);
    }
  }

  draw();
  return {
    show(district) {
      state = { ...state, district, month: null, year: null, disease: getSelection().disease, scenario: getSelection().scenario };
      track("drilldown", { screen: "map", district });
      draw();
      host.scrollIntoView({ block: "nearest" });
    },
    refresh() {
      const g = getSelection();
      const same = state.district === g.district && state.disease === g.disease && state.scenario === g.scenario;
      if (same) return;
      state = { ...state, district: g.district, disease: g.disease, scenario: g.scenario, month: null, year: null };
      draw();
    },
  };
}
