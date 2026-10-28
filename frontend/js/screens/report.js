// Screen 5: exportable scenario report for the current selection.
import { CONFIG } from "../config.js";
import { can } from "../auth.js";
import { api } from "../api.js";
import { getSelection, onSelection } from "../state.js";
import { esc, monthLabel, byId, tsrText, deltaText, statusPill, fmtInt, plural, STATUS, disclaimerBody } from "../format.js";
import { selectorsHTML, scenarioSelectHTML, bindSelects, renderSimulationView, wavesTableHTML, anomalyListHTML, loadingHTML, errorHTML, downloadFile, copyText, toast } from "../ui.js";

export async function render(view, { meta }) {
  let seq = 0;
  let current = null;
  const allowExport = can("exports");
  const PRINT = CONFIG.ENABLE_PRINT && allowExport, FILES = CONFIG.ENABLE_FILE_DOWNLOADS && allowExport;
  view.innerHTML = `
    <div class="page-head no-print">
      <div>
        <p class="eyebrow">Screen 5 · Scenario report</p>
        <h1>Scenario report</h1>
        <p class="lede">A one-page summary of the selected scenario for the project report or viva. Every figure comes from the API response, which can also be downloaded.</p>
      </div>
    </div>
    <section class="panel no-print">
      <div class="row" style="align-items:flex-end;justify-content:space-between">
        <div class="row" style="align-items:flex-end">${selectorsHTML(meta, getSelection(), { idPrefix: "rep" })}${scenarioSelectHTML(meta, getSelection(), "rep")}</div>
        <div class="report-actions">
          ${PRINT ? '<button class="btn btn-primary" type="button" id="rep-print"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>Print or save as PDF</button>' : ""}
          ${FILES ? '<button class="btn" type="button" id="rep-json">Download JSON</button><button class="btn" type="button" id="rep-csv">Download CSV</button>' : ""}
          <button class="btn" type="button" id="rep-copy">Copy summary</button>
        </div>
      </div>
      ${!allowExport ? '<p class="small" style="margin-top:8px">Exporting needs an Analyst or Admin account. You can still read the report and copy its summary.</p>' : CONFIG.ENABLE_FILE_DOWNLOADS ? "" : '<p class="small" style="margin-top:8px">File downloads and printing are turned off in this hosted preview. Run the app locally to export PDF, JSON and CSV.</p>'}
    </section>
    <article class="report" id="report">${loadingHTML("Building report…")}</article>`;
  bindSelects(view);

  view.querySelector("#rep-print")?.addEventListener("click", () => window.print());
  view.querySelector("#rep-json")?.addEventListener("click", () => current && downloadFile(fileBase(current) + ".json", JSON.stringify(current, null, 2), "application/json"));
  view.querySelector("#rep-csv")?.addEventListener("click", () => current && downloadFile(fileBase(current) + ".csv", toCSV(current), "text/csv"));
  view.querySelector("#rep-copy").addEventListener("click", () => current && copyText(summaryText(current, meta), view.querySelector("#rep-summary")));

  async function update() {
    const my = ++seq;
    const s = getSelection();
    view.querySelectorAll("select[data-key]").forEach((el) => (el.value = s[el.dataset.key]));
    const host = view.querySelector("#report");
    try {
      const sim = await api.simulation(s);
      if (my !== seq) return;
      current = sim;
      const scen = byId(meta.scenarios, s.scenario), dist = byId(meta.districts, s.district), dis = byId(meta.diseases, s.disease);
      const rec = sim.recovery, end = meta.horizon.end_month;
      const b = tsrText(rec.baseline, end), t = tsrText(rec.scenario, end), d = deltaText(rec);
      const u = rec.scenario.uncertainty || {};
      host.innerHTML = `
        <header class="stack" style="gap:8px">
          <p class="eyebrow">EpiMetrics-Climate · scenario report · dataset v${esc(meta.dataset_version)}</p>
          <h2 class="r-title">${esc(scen.label)}: ${esc(dis.name)} in ${esc(dist.name)}</h2>
          <div class="callout callout-warn"><b>Synthetic data, research demonstration only.</b> ${esc(disclaimerBody(meta))}</div>
        </header>
        <section><h3>Summary</h3><p class="r-summary" id="rep-summary">${esc(summaryText(sim, meta))}</p></section>
        <section><h3>Recovery results</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Measure</th><th>Baseline climate</th>${s.scenario === "baseline" ? "" : `<th>${esc(scen.label)}</th>`}</tr></thead>
            <tbody>
              <tr><td>Time to sustained recovery</td><td>${esc(b.value)} ${esc(b.unit)}</td>${s.scenario === "baseline" ? "" : `<td>${esc(t.value)} ${esc(t.unit)}</td>`}</tr>
              <tr><td>Recovery month (confirmed)</td><td>${monthLabel(rec.baseline.recovery_month)} (${monthLabel(rec.baseline.recovery_confirmed_month)})</td>${s.scenario === "baseline" ? "" : `<td>${monthLabel(rec.scenario.recovery_month)} (${monthLabel(rec.scenario.recovery_confirmed_month)})</td>`}</tr>
              <tr><td>Status</td><td>${statusPill(rec.baseline.status)}</td>${s.scenario === "baseline" ? "" : `<td>${statusPill(rec.scenario.status)}</td>`}</tr>
              <tr><td>Interruptions before recovery</td><td>${fmtInt(rec.baseline.interruption_count)}</td>${s.scenario === "baseline" ? "" : `<td>${fmtInt(rec.scenario.interruption_count)}</td>`}</tr>
              <tr><td>Months above threshold after t0</td><td>${fmtInt(rec.baseline.months_above_threshold)}</td>${s.scenario === "baseline" ? "" : `<td>${fmtInt(rec.scenario.months_above_threshold)}</td>`}</tr>
              <tr><td>Spread across ${esc(meta.replicates)} replicates (p10–p90)</td><td>${spread(rec.baseline)}</td>${s.scenario === "baseline" ? "" : `<td>${spread(rec.scenario)}</td>`}</tr>
              <tr><td><b>Recovery delay ΔTSR</b></td><td colspan="2"><b>${esc(d.value)} ${esc(d.unit)}</b> · ${esc(d.note)}</td></tr>
            </tbody></table></div>
        </section>
        <section><h3>Cases, threshold and recovery</h3><div id="rep-view"></div></section>
        <section class="grid cols-2">
          <div><h3>Secondary waves</h3>${wavesTableHTML(sim, meta)}</div>
          <div><h3>Climate anomaly applied</h3>${anomalyListHTML(sim)}<p class="small" style="margin-top:8px">${esc(scen.description)}. Hypothetical input, not a projection.</p></div>
        </section>
        <section class="grid cols-2">
          <div><h3>Method and definitions</h3><ul class="plain small">
            <li>Reference peak t0: ${monthLabel(sim.reference.t0_month)}, the outbreak peak in the baseline series. Shared by every scenario.</li>
            <li>Endemic threshold: ${esc(meta.recovery_rule.threshold_definition)}.</li>
            <li>TSR: ${esc(meta.recovery_rule.tsr_definition)}.</li>
            <li>Secondary wave: ${esc(meta.recovery_rule.interruption_definition)}.</li>
            <li>Censored series (no recovery by ${monthLabel(end)}) report a lower bound, never an invented date.</li></ul></div>
          <div><h3>Limitations</h3><ul class="plain small">${meta.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>
        </section>
        <footer class="small" style="border-top:1px solid var(--line);padding-top:10px">
          Source: ${esc(sim.provenance.source)} API v${esc(sim.api_version)} · dataset v${esc(sim.dataset_version)} · generator v${esc(sim.provenance.generator_version)} · seed ${esc(sim.provenance.seed)} · rule ${esc(sim.provenance.recovery_rule)} · ${esc(sim.provenance.generated_from)}
        </footer>`;
      renderSimulationView(host.querySelector("#rep-view"), sim, meta, { range: "focus", idPrefix: "rep" });
    } catch (err) {
      if (my !== seq) return;
      current = null;
      host.innerHTML = errorHTML(err, "rep-retry");
      host.querySelector("#rep-retry")?.addEventListener("click", update);
    }
  }
  const off = onSelection(update);
  await update();
  return off;
}

function spread(block) {
  const u = block.uncertainty || {};
  return u.p10_months != null ? `${Math.round(u.p10_months * 10) / 10}–${Math.round(u.p90_months * 10) / 10} months` : "not available";
}

function fileBase(sim) {
  const r = sim.request;
  return `epimetrics_${r.district}_${r.disease}_${r.scenario}_v${sim.dataset_version}`;
}

export function summaryText(sim, meta) {
  const r = sim.request;
  const scen = byId(meta.scenarios, r.scenario), dist = byId(meta.districts, r.district), dis = byId(meta.diseases, r.disease);
  const end = meta.horizon.end_month;
  const b = tsrText(sim.recovery.baseline, end), t = tsrText(sim.recovery.scenario, end), d = deltaText(sim.recovery);
  const lead = `Synthetic simulation, not a forecast. ${dis.name} in ${dist.name} reaches its reference peak in ${monthLabel(sim.reference.t0_month)}.`;
  if (r.scenario === "baseline") return `${lead} Under the baseline climate, sustained recovery takes ${b.value} ${b.unit} (${STATUS[sim.recovery.baseline.status]?.label.toLowerCase() || sim.recovery.baseline.status}), with ${plural(sim.recovery.baseline.interruption_count, "secondary wave")} interrupting recovery.`;
  const n = sim.recovery.scenario.interruption_count;
  return `${lead} Under the ${scen.label.toLowerCase()} scenario, sustained recovery takes ${t.value} ${t.unit}, compared with ${b.value} ${b.unit} under the baseline climate: a recovery delay (ΔTSR) of ${d.value} ${d.unit}. ${n ? `${plural(n, "secondary wave")} ${n === 1 ? "interrupts" : "interrupt"} recovery.` : "No secondary wave interrupts recovery."} Status: ${STATUS[sim.recovery.scenario.status]?.label.toLowerCase() || sim.recovery.scenario.status}.`;
}

function toCSV(sim) {
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const head = ["month", "baseline_cases", "scenario_cases", "threshold_cases", "baseline_rainfall_mm", "scenario_rainfall_mm", "baseline_mean_temperature_c", "scenario_mean_temperature_c"];
  const B = sim.series.baseline, S = sim.series.scenario;
  const lines = [
    `# EpiMetrics-Climate synthetic data, not a forecast. district=${sim.request.district} disease=${sim.request.disease} scenario=${sim.request.scenario} dataset=${sim.dataset_version} rule=${sim.request.recovery_rule}`,
    head.join(","),
  ];
  sim.months.forEach((m, i) => lines.push([m, B.observed_cases[i], S.observed_cases[i], sim.threshold_cases[i], B.rainfall_mm[i], S.rainfall_mm[i], B.mean_temperature_c[i], S.mean_temperature_c[i]].map(q).join(",")));
  return lines.join("\n");
}
