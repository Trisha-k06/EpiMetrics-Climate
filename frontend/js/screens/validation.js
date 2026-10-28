// Screen 7: validation, uncertainty and limitations.
import { api } from "../api.js";
import { getSelection, setSelection, onSelection } from "../state.js";
import { esc, byId, monthLabel, fmtInt } from "../format.js";
import { scatterChart } from "../charts.js";
import { loadingHTML, errorHTML, screenEyebrow } from "../ui.js";

const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const maskKey = (m) => (m == null ? "none" : m);
const STATUS_SHORT = { recovered: "recovered", not_recovered_within_horizon: "censored", insufficient_data: "insufficient data" };

export async function render(view, { meta }) {
  let mask = "none";
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${screenEyebrow("validation", "Validation, uncertainty & limitations")}</p>
        <h1>Can recovery be estimated from noisy case data?</h1>
        <p class="lede">Because the data is synthetic, the true recovery time of every series is known. This screen compares the recovery engine's estimates from observed cases with that ground truth, under missing data and alternative recovery rules.</p>
      </div>
    </div>
    <section class="callout callout-accent"><b>Ground truth is used for evaluation only.</b> It comes from noise-free expected cases and the true endemic level. It is never given to a model or shown as a result on the other screens.</section>
    <section class="panel stack">
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <div class="field"><label for="val-disease">Disease</label><select id="val-disease">${meta.diseases.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}</select></div>
        <div class="field" style="min-width:0"><span class="label" id="val-mask-label">Missing-data test</span>
          <div class="seg" role="group" aria-labelledby="val-mask-label" style="flex-wrap:wrap">${meta.masks.map((m) => `<button type="button" data-mask="${esc(maskKey(m.id))}" aria-pressed="${maskKey(m.id) === mask}" title="${esc(m.description)}">${esc(m.label)}</button>`).join("")}</div></div>
      </div>
      <p class="small" id="val-mask-desc"></p>
      <div id="val-kpis">${loadingHTML()}</div>
    </section>
    <section class="grid cols-2">
      <div class="panel"><div class="panel-head"><h2>Estimated vs true recovery time</h2><span class="small">One dot per series · bars show p10–p90 across noise replicates</span></div>
        <div id="val-scatter"></div><div id="val-excluded" style="margin-top:10px"></div></div>
      <div class="panel"><div class="panel-head"><h2>Sensitivity to the recovery rule</h2><span class="small">Complete data</span></div>
        <div id="val-sens"></div>
        <p class="small" style="margin-top:10px">A higher threshold factor lowers the error but declares recovery at higher case levels. The rule is a project choice, and the report should state it.</p></div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Every series under this test</h2></div><div id="val-table"></div></section>
    <section class="grid cols-2">
      <div class="panel"><div class="panel-head"><h2>Limitations</h2></div><ul class="plain small">${meta.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>
      <div class="panel"><div class="panel-head"><h2>How to read uncertainty</h2></div><ul class="plain small">
        <li>The recovery engine runs on ${esc(meta.replicates)} noisy replicates of each series. The p10–p90 range shows how much TSR moves with reporting noise alone.</li>
        <li>No range is shown when fewer than half of the replicates recover.</li>
        <li>Climate and disease assumptions are not varied here, so the range understates total uncertainty.</li>
        <li>A censored estimate means no sustained recovery before ${monthLabel(meta.horizon.end_month)}; it has no error value.</li>
        <li>With more than ${Math.round(meta.recovery_rule.max_missing_frac * 100)}% of months missing after t0 the engine returns "insufficient data" instead of a guess.</li>
      </ul></div>
    </section>`;

  const dSel = view.querySelector("#val-disease");
  dSel.addEventListener("change", () => setSelection({ disease: dSel.value }));
  view.querySelectorAll("[data-mask]").forEach((b) => b.addEventListener("click", () => {
    mask = b.dataset.mask;
    view.querySelectorAll("[data-mask]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  }));

  let data = null, loadedFor = null;
  async function draw() {
    const s = getSelection();
    dSel.value = s.disease;
    const m = meta.masks.find((x) => maskKey(x.id) === mask);
    view.querySelector("#val-mask-desc").textContent = m ? `${m.label}: ${m.description}.` : "";
    try {
      if (loadedFor !== s.disease) { data = await api.validation({ disease: s.disease }); loadedFor = s.disease; }
    } catch (err) { view.querySelector("#val-kpis").innerHTML = errorHTML(err); return; }
    const sum = data.summary_by_mask.find((x) => maskKey(x.mask) === mask);
    const rows = data.rows.filter((r) => maskKey(r.mask) === mask);
    view.querySelector("#val-kpis").innerHTML = sum ? `<div class="kpis">
      <article class="kpi kpi-primary"><div class="kpi-label">Mean absolute error</div><div class="kpi-value">${sum.mae_months ?? "—"}<span class="unit">${sum.mae_months == null ? "" : "months"}</span></div><div class="kpi-compare"><span>Over ${fmtInt(sum.n_compared)} of ${fmtInt(sum.n_series)} series where truth and estimate both recovered</span></div></article>
      <article class="kpi"><div class="kpi-label">Status agreement</div><div class="kpi-value">${pct(sum.status_agreement)}</div><div class="kpi-compare"><span>Estimated status (recovered, censored, insufficient) matches the truth</span></div></article>
      <article class="kpi"><div class="kpi-label">Censored estimates</div><div class="kpi-value">${fmtInt(sum.n_censored_estimate)}</div><div class="kpi-compare"><span>No sustained recovery seen in observed cases</span></div></article>
      <article class="kpi"><div class="kpi-label">Insufficient data</div><div class="kpi-value">${fmtInt(sum.n_insufficient_data)}</div><div class="kpi-compare"><span>${sum.n_insufficient_data ? "The engine declined to estimate, as designed" : "Every series had enough data"}</span></div></article>
    </div>` : `<div class="state">This test is not provided by the API.</div>`;

    const sc = (r) => byId(meta.scenarios, r.scenario)?.label || r.scenario;
    const dn = (r) => byId(meta.districts, r.district)?.name || r.district;
    const pts = rows.filter((r) => r.estimated_tsr_months != null && r.true_tsr_months != null)
      .map((r) => ({ x: r.true_tsr_months, y: r.estimated_tsr_months, p10: r.p10_months == null ? null : Math.round(r.p10_months * 10) / 10, p90: r.p90_months == null ? null : Math.round(r.p90_months * 10) / 10, label: `${sc(r)} · ${dn(r)}` }));
    const scatterHost = view.querySelector("#val-scatter");
    if (pts.length) {
      scatterHost.innerHTML = "";
      scatterChart(scatterHost, { points: pts, ariaLabel: `Estimated versus true time to sustained recovery for ${pts.length} series` });
    } else {
      scatterHost.innerHTML = `<div class="state">No series can be compared under this test: the engine returned no recovery estimates.</div>`;
    }
    const excluded = rows.filter((r) => r.estimated_tsr_months == null || r.true_tsr_months == null);
    view.querySelector("#val-excluded").innerHTML = excluded.length
      ? `<p class="small">Not plotted, because the truth or the estimate has no recovery time: ${excluded.map((r) => `${esc(sc(r))} · ${esc(dn(r))} (true: ${STATUS_SHORT[r.true_status] || r.true_status}, estimate: ${STATUS_SHORT[r.estimated_status] || r.estimated_status})`).slice(0, 6).join("; ")}${excluded.length > 6 ? `; and ${excluded.length - 6} more in the table below` : ""}.</p>` : "";

    const sens = data.sensitivity;
    const windows = [...new Set(sens.map((x) => x.window_months))].sort((a, b) => a - b);
    const factors = [...new Set(sens.map((x) => x.threshold_factor))].sort((a, b) => a - b);
    const cell = (w, f) => sens.find((x) => x.window_months === w && x.threshold_factor === f);
    view.querySelector("#val-sens").innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Window</th>${factors.map((f) => `<th class="n">× ${f}</th>`).join("")}</tr></thead>
      <tbody>${windows.map((w) => `<tr><td>${w} months</td>${factors.map((f) => { const c = cell(w, f); return `<td class="n" ${c?.is_default ? 'style="background:var(--accent-soft);font-weight:600"' : ""}>${c ? `${c.mae_months} mo<br><span class="small">${pct(c.status_agreement)} status</span>${c.is_default ? '<br><span class="pill pill-neutral" style="margin-top:4px">default</span>' : ""}` : "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="small" style="margin-top:8px">Mean absolute error (months) and status agreement for each combination of confirmation window and threshold factor.</p>`;

    view.querySelector("#val-table").innerHTML = `<div class="table-wrap scroll-y"><table>
      <thead><tr><th>Scenario</th><th>District</th><th class="n">True TSR</th><th class="n">Estimated TSR</th><th class="n">p10–p90</th><th class="n">Error</th><th>Status</th><th>t0 (est. / true)</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(sc(r))}</td><td>${esc(dn(r))}</td>
        <td class="n">${r.true_tsr_months ?? STATUS_SHORT[r.true_status] ?? "—"}</td>
        <td class="n">${r.estimated_tsr_months ?? STATUS_SHORT[r.estimated_status] ?? "—"}</td>
        <td class="n">${r.p10_months != null ? `${Math.round(r.p10_months * 10) / 10}–${Math.round(r.p90_months * 10) / 10}` : "—"}</td>
        <td class="n">${r.absolute_error_months ?? "—"}</td>
        <td>${r.status_match ? '<span class="pill pill-good">match</span>' : '<span class="pill pill-warn">differs</span>'}</td>
        <td>${monthLabel(r.estimated_reference_month, "short")} / ${monthLabel(r.true_reference_month, "short")}</td></tr>`).join("")}</tbody></table></div>
      <p class="small" style="margin-top:8px">${data.notes.map(esc).join(" ")}</p>`;
  }

  const off = onSelection(draw);
  await draw();
  return off;
}
