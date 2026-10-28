// Shared UI building blocks. Values shown here are read from API responses as-is.
import { CONFIG } from "./config.js";
import { esc, monthLabel, fmtInt, statusPill, tsrText, deltaText, anomalyText, byId, rangeIdx, plural } from "./format.js";
import { timeChart, recoveryTrack } from "./charts.js";
import { setSelection } from "./state.js";

export const COLORS = { baseline: "var(--baseline)", scenario: "var(--scenario)", threshold: "var(--threshold)" };
// Categorical series colours (validated palette, fixed order; never cycled). Diseases keep one colour everywhere.
export const CAT = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];
export const DISEASE_COLORS = { dengue: "var(--c3)", malaria: "var(--c7)" };

export function passPill(ok, yes = "PASS", no = "FAIL") {
  return ok ? `<span class="pill pill-good">✓ ${esc(yes)}</span>` : `<span class="pill pill-crit">✗ ${esc(no)}</span>`;
}

export function loadingHTML(label = "Loading data…") {
  return `<div class="state" aria-busy="true"><div class="skeleton" style="width:100%;height:14px"></div><div class="skeleton" style="width:70%;height:14px"></div><span class="small">${esc(label)}</span></div>`;
}

export function errorHTML(err, retryId) {
  return `<div class="state state-error" role="alert"><b>Data could not be shown</b><span>${esc(err?.message || String(err))}</span>${retryId ? `<button class="btn" id="${retryId}" type="button">Try again</button>` : ""}</div>`;
}

export function selectorsHTML(meta, sel, { idPrefix = "s" } = {}) {
  const opt = (list, cur, label) => list.map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? "selected" : ""}>${esc(label(x))}</option>`).join("");
  return `<div class="controls">
    <div class="field"><label for="${idPrefix}-district">District</label><select id="${idPrefix}-district" data-key="district">${opt(meta.districts, sel.district, (d) => `${d.name} (${d.climate_zone})`)}</select></div>
    <div class="field"><label for="${idPrefix}-disease">Disease</label><select id="${idPrefix}-disease" data-key="disease">${opt(meta.diseases, sel.disease, (d) => d.name)}</select></div>
  </div>`;
}

export function scenarioSelectHTML(meta, sel, idPrefix = "s") {
  return `<div class="field"><label for="${idPrefix}-scenario">Climate scenario</label><select id="${idPrefix}-scenario" data-key="scenario">${meta.scenarios.map((s) => `<option value="${esc(s.id)}" ${s.id === sel.scenario ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>`;
}

export function maskSelectHTML(meta, sel, idPrefix = "s") {
  return `<div class="field"><label for="${idPrefix}-mask">Reporting completeness</label><select id="${idPrefix}-mask" data-key="mask">${meta.masks.map((m) => `<option value="${esc(m.id)}" ${m.id === (sel.mask || "none") ? "selected" : ""} title="${esc(m.description)}">${esc(m.label)}</option>`).join("")}</select></div>`;
}

/** Runs of consecutive months where a series has no value (masked reporting). Display only. */
export function gapRuns(months, ...arrays) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= months.length; i++) {
    const missing = i < months.length && arrays.some((a) => a[i] == null);
    if (missing && start < 0) start = i;
    if (!missing && start >= 0) { out.push({ start: months[start], end: months[i - 1], n: i - start }); start = -1; }
  }
  return out;
}

export function bindSelects(root) {
  root.querySelectorAll("select[data-key]").forEach((s) => s.addEventListener("change", () => setSelection({ [s.dataset.key]: s.value })));
}

export function scenarioPickerHTML(meta, sel) {
  return `<fieldset class="scenario-picker"><legend>Climate scenario · 7 predefined</legend><div class="scenario-list">
    ${meta.scenarios.map((s) => `<label class="scenario-option">
      <input type="radio" name="scenario" value="${esc(s.id)}" ${s.id === sel.scenario ? "checked" : ""}>
      <span class="scenario-card"><span class="s-tag">${esc(s.category)}</span><span class="s-name">${s.featured && s.id !== "baseline" ? '<span class="featured-dot" aria-hidden="true"></span>' : ""}${esc(s.label)}</span><span class="s-short">${esc(s.short)}</span></span>
    </label>`).join("")}
  </div></fieldset>`;
}

export function bindScenarioPicker(root) {
  root.querySelectorAll('input[name="scenario"]').forEach((r) => r.addEventListener("change", () => r.checked && setSelection({ scenario: r.value })));
}

const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

export function kpiCardsHTML(sim, meta) {
  const rec = sim.recovery;
  const end = meta.horizon.end_month;
  const isBase = sim.request.scenario === "baseline";
  const s = tsrText(rec.scenario, end), b = tsrText(rec.baseline, end), d = deltaText(rec);
  const u = rec.scenario.uncertainty || {};
  const spread = u.p10_months != null ? `${r1(u.p10_months)}–${r1(u.p90_months)} months across ${u.replicates} noise replicates` : "Spread not available (fewer than half of replicates recovered)";
  const interrupting = (sim.waves.scenario || []).filter((w) => w.interrupts_recovery);
  return `<div class="kpis">
    <article class="kpi tilt">
      <div class="kpi-label">Time to sustained recovery</div>
      <div class="kpi-value">${esc(s.value)}<span class="unit">${esc(s.unit)}</span></div>
      <div class="kpi-compare">
        <span class="k-row"><span class="swatch swatch-scenario"></span>${isBase ? "Baseline" : "Scenario"}: ${esc(s.note)}</span>
        ${isBase ? "" : `<span class="k-row"><span class="swatch swatch-baseline"></span>Baseline: ${esc(b.value)} ${esc(b.unit)}</span>`}
        <span class="k-row muted">${esc(spread)}</span>
      </div>
    </article>
    <article class="kpi kpi-primary tilt">
      <div class="kpi-label">Recovery delay · ΔTSR</div>
      <div class="kpi-value">${esc(d.value)}<span class="unit">${esc(d.unit)}</span></div>
      <div class="kpi-compare"><span>${isBase ? "Baseline compared with itself. Choose a climate scenario to see a delay." : esc(d.note)}</span><span class="muted">ΔTSR = TSR(scenario) − TSR(baseline)</span></div>
    </article>
    <article class="kpi tilt">
      <div class="kpi-label">Recovery interruptions</div>
      <div class="kpi-value">${fmtInt(rec.scenario.interruption_count)}<span class="unit">${rec.scenario.interruption_count === 1 ? "wave" : "waves"}</span></div>
      <div class="kpi-compare">
        ${isBase ? "" : `<span class="k-row"><span class="swatch swatch-baseline"></span>Baseline: ${plural(rec.baseline.interruption_count, "wave")}</span>`}
        <span>${interrupting.length ? `First interrupting wave: ${monthLabel(interrupting[0].onset_month)}` : "No secondary wave before recovery"}</span>
        <span class="muted">${fmtInt(rec.scenario.months_above_threshold)} months above threshold after t0</span>
      </div>
    </article>
    <article class="kpi tilt">
      <div class="kpi-label">Recovery status</div>
      <div>${statusPill(rec.scenario.status)}</div>
      <div class="kpi-compare">
        ${isBase ? "" : `<span class="k-row"><span class="swatch swatch-baseline"></span>Baseline: ${esc((rec.baseline.status || "").replaceAll("_", " "))}</span>`}
        <span>${u.share_replicates_recovered != null ? `${Math.round(u.share_replicates_recovered * 100)}% of replicates recovered` : ""}</span>
        <span class="muted">Rule: ${esc(sim.request.recovery_rule)} · horizon ${monthLabel(end)}</span>
      </div>
    </article>
  </div>`;
}

function legendHTML(isBase, hasGaps) {
  return `<div class="chart-legend" aria-hidden="true">
    <span><span class="swatch swatch-baseline"></span>Baseline climate (S0)</span>
    ${isBase ? "" : '<span><span class="swatch swatch-scenario"></span>Scenario climate</span>'}
    <span><span class="swatch swatch-line"></span>Endemic threshold</span>
    <span><span class="swatch swatch-anomaly"></span>Climate anomaly window</span>
    <span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" style="fill:var(--scenario)"/></svg>Secondary-wave peak</span>
    ${hasGaps ? '<span><span class="swatch swatch-gap"></span>Months with no reported cases (gap)</span>' : ""}
  </div>`;
}

export function trackLegendHTML() {
  return `<div class="track-legend" aria-hidden="true">
    <span><span class="swatch" style="background:var(--ink-3);opacity:.35;width:22px"></span>Peak to recovery (TSR)</span>
    <span><span class="swatch" style="background:var(--ink-2);width:22px"></span>3-month confirmation window</span>
    <span><svg width="14" height="14"><path d="M7 1L13 7L7 13L1 7Z" style="fill:var(--ink)"/></svg>Secondary wave interrupting recovery</span>
    <span><svg width="14" height="14"><path d="M7 1L13 7L7 13L1 7Z" style="fill:var(--surface);stroke:var(--ink);stroke-width:1.6"/></svg>Wave after recovery</span>
  </div>`;
}

/** Compose the case chart, recovery track and climate charts for one simulation response. */
export function renderSimulationView(root, sim, meta, { range = "focus", climate = true, idPrefix = "sv" } = {}) {
  const isBase = sim.request.scenario === "baseline";
  const months = sim.months;
  const R = range === "full" ? [0, months.length - 1] : rangeIdx(months, CONFIG.FOCUS_RANGE.start, CONFIG.FOCUS_RANGE.end);
  const scen = byId(meta.scenarios, sim.request.scenario);
  const dist = byId(meta.districts, sim.request.district);
  const dis = byId(meta.diseases, sim.request.disease);
  const rec = sim.recovery;
  const bands = sim.anomaly_windows.map((a) => ({ start: a.start_month, end: a.end_month, label: "" }));
  const gaps = gapRuns(months, sim.series.baseline.observed_cases, sim.series.scenario.observed_cases);
  const caseBands = [...bands, ...gaps.map((g) => ({ start: g.start, end: g.end, label: g.n >= 3 ? "no data" : "", fill: "var(--gap)", stroke: "var(--ink-3)" }))];
  const insufficient = rec.scenario.status === "insufficient_data" || rec.baseline.status === "insufficient_data";

  root.innerHTML = `
    ${insufficient ? `<div class="callout callout-warn" role="note" style="margin-bottom:10px"><b>Insufficient data.</b> More than ${Math.round(meta.recovery_rule.max_missing_frac * 100)}% of the months after the reference peak have no reported cases, so the recovery engine gives no recovery time instead of guessing.</div>` : ""}
    ${gaps.length ? `<p class="small" style="margin-bottom:6px">${gaps.reduce((a, g) => a + g.n, 0)} months have no reported cases under “${esc(byId(meta.masks, sim.request.mask || "none")?.label || "")}”. The lines break there; nothing is filled in.</p>` : ""}
    ${legendHTML(isBase, gaps.length > 0)}
    <div id="${idPrefix}-cases"></div>
    <div class="small" style="margin:10px 0 2px">Recovery timeline from the reference peak (t0)</div>
    <div id="${idPrefix}-track"></div>
    ${trackLegendHTML()}
    ${climate ? `<div class="grid cols-2" style="margin-top:18px">
      <div><div class="small" style="font-weight:600;color:var(--ink)">Monthly rainfall</div><div id="${idPrefix}-rain"></div></div>
      <div><div class="small" style="font-weight:600;color:var(--ink)">Mean temperature</div><div id="${idPrefix}-temp"></div></div>
    </div>` : ""}`;

  const vlines = [{ month: sim.reference.t0_month, label: "t0 peak", color: "var(--ink-2)", dash: "4 3", top: true }];
  if (rec.baseline.recovery_month) vlines.push({ month: rec.baseline.recovery_month, label: "Baseline recovers", color: COLORS.baseline, dash: "6 4", row: isBase ? 0 : 1 });
  if (!isBase && rec.scenario.recovery_month) vlines.push({ month: rec.scenario.recovery_month, label: "Scenario recovers", color: COLORS.scenario, dash: "6 4", row: 0 });
  const markers = [];
  if (!isBase) for (const w of sim.waves.scenario) markers.push({ month: w.peak_month, value: sim.series.scenario.observed_cases[months.indexOf(w.peak_month)], color: COLORS.scenario, label: w.interrupts_recovery ? "Secondary wave" : "Later wave" });
  for (const w of sim.waves.baseline) markers.push({ month: w.peak_month, value: sim.series.baseline.observed_cases[months.indexOf(w.peak_month)], color: COLORS.baseline, label: isBase ? (w.interrupts_recovery ? "Secondary wave" : "Later wave") : "" });

  const notesAt = (m) => {
    const out = [];
    if (m === sim.reference.t0_month) out.push("t0: reference outbreak peak (baseline)");
    if (gaps.some((g) => m >= g.start && m <= g.end)) out.push("No reported cases this month (masked)");
    if (sim.anomaly_windows.some((a) => m >= a.start_month && m <= a.end_month)) out.push("Climate anomaly active");
    if (m === rec.baseline.recovery_month) out.push("Baseline: sustained recovery begins");
    if (!isBase && m === rec.scenario.recovery_month) out.push("Scenario: sustained recovery begins");
    for (const w of isBase ? sim.waves.baseline : sim.waves.scenario) if (w.onset_month === m) out.push(`Secondary wave onset${w.interrupts_recovery ? " (interrupts recovery)" : ""}`);
    return out;
  };
  const series = [{ label: "Baseline cases", values: sim.series.baseline.observed_cases, color: COLORS.baseline }];
  if (!isBase) series.push({ label: "Scenario cases", values: sim.series.scenario.observed_cases, color: COLORS.scenario });

  timeChart(root.querySelector(`#${idPrefix}-cases`), {
    months, range: R, unit: "Cases / month", series, steps: { label: "Threshold", values: sim.threshold_cases, color: COLORS.threshold },
    bands: caseBands, vlines, markers, notesAt,
    ariaLabel: `Monthly ${dis?.name} cases in ${dist?.name}, baseline${isBase ? "" : ` versus ${scen?.label}`}, with the endemic threshold, t0 peak, recovery months and secondary waves.`,
  });
  recoveryTrack(root.querySelector(`#${idPrefix}-track`), {
    months, range: R, t0: sim.reference.t0_month, horizonEnd: meta.horizon.end_month,
    rows: isBase ? [{ label: "Baseline", color: COLORS.baseline, block: rec.baseline, waves: sim.waves.baseline }]
      : [{ label: "Baseline", color: COLORS.baseline, block: rec.baseline, waves: sim.waves.baseline }, { label: scen?.label || "Scenario", color: COLORS.scenario, block: rec.scenario, waves: sim.waves.scenario }],
    ariaLabel: "Recovery timeline: bars run from the reference peak to sustained recovery, followed by the 3-month confirmation window. Diamonds mark secondary waves.",
  });
  if (climate) {
    const climSeries = (key, labelB, labelS) => {
      const s = [{ label: labelB, values: sim.series.baseline[key], color: COLORS.baseline }];
      if (!isBase) s.push({ label: labelS, values: sim.series.scenario[key], color: COLORS.scenario });
      return s;
    };
    timeChart(root.querySelector(`#${idPrefix}-rain`), { months, range: R, height: 200, unit: "mm", unitShort: "mm", series: climSeries("rainfall_mm", "Baseline", "Scenario"), bands: bands.map((b) => ({ ...b, label: "" })), valueFmt: (v) => fmtInt(Math.round(v)), ariaLabel: "Monthly rainfall, baseline versus scenario" });
    timeChart(root.querySelector(`#${idPrefix}-temp`), { months, range: R, height: 200, unit: "°C", unitShort: "°C", yFloorZero: false, series: climSeries("mean_temperature_c", "Baseline", "Scenario"), bands: bands.map((b) => ({ ...b, label: "" })), valueFmt: (v) => v.toFixed(1), ariaLabel: "Monthly mean temperature, baseline versus scenario" });
  }
}

export function dataTableHTML(sim, meta, range = "focus") {
  const months = sim.months;
  const [i0, i1] = range === "full" ? [0, months.length - 1] : rangeIdx(months, CONFIG.FOCUS_RANGE.start, CONFIG.FOCUS_RANGE.end);
  const isBase = sim.request.scenario === "baseline";
  let rows = "";
  for (let i = i0; i <= i1; i++) {
    rows += `<tr><td>${monthLabel(months[i])}</td><td class="n">${fmtInt(sim.series.baseline.observed_cases[i])}</td>${isBase ? "" : `<td class="n">${fmtInt(sim.series.scenario.observed_cases[i])}</td>`}<td class="n">${fmtInt(Math.round(sim.threshold_cases[i]))}</td><td class="n">${sim.series.baseline.rainfall_mm[i]}</td>${isBase ? "" : `<td class="n">${sim.series.scenario.rainfall_mm[i]}</td>`}</tr>`;
  }
  return `<details class="data-table"><summary>Show the data behind these charts</summary>
    <div class="table-wrap scroll-y" style="margin-top:8px"><table>
      <thead><tr><th>Month</th><th class="n">Baseline cases</th>${isBase ? "" : '<th class="n">Scenario cases</th>'}<th class="n">Threshold</th><th class="n">Baseline rain (mm)</th>${isBase ? "" : '<th class="n">Scenario rain (mm)</th>'}</tr></thead>
      <tbody>${rows}</tbody></table></div></details>`;
}

export function wavesTableHTML(sim, meta) {
  const isBase = sim.request.scenario === "baseline";
  const list = [
    ...sim.waves.baseline.map((w) => ({ ...w, who: "Baseline" })),
    ...(isBase ? [] : sim.waves.scenario.map((w) => ({ ...w, who: byId(meta.scenarios, sim.request.scenario)?.label || "Scenario" }))),
  ];
  if (!list.length) return `<p class="small">No secondary waves were detected after the reference peak in ${isBase ? "the baseline" : "either series"}.</p>`;
  return `<div class="table-wrap"><table><thead><tr><th>Series</th><th>Wave onset</th><th>Wave peak</th><th class="n">Peak cases</th><th>Effect</th></tr></thead><tbody>
    ${list.map((w) => `<tr><td>${esc(w.who)}</td><td>${monthLabel(w.onset_month)}</td><td>${monthLabel(w.peak_month)}</td><td class="n">${fmtInt(w.peak_cases)}</td><td>${w.interrupts_recovery ? '<span class="pill pill-warn">Interrupts recovery</span>' : '<span class="pill pill-neutral">After recovery</span>'}</td></tr>`).join("")}
  </tbody></table></div>`;
}

export function anomalyListHTML(sim) {
  if (!sim.anomaly_windows.length) return '<p class="small">No anomaly: this is the generated baseline climate.</p>';
  return `<ul class="plain">${sim.anomaly_windows.map((a) => `<li>${esc(anomalyText(a))}</li>`).join("")}</ul>`;
}

let toastTimer = 0;
export function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

export function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    if (fallbackEl) {
      const range = document.createRange();
      range.selectNodeContents(fallbackEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast("Text selected. Press Ctrl+C or ⌘C to copy.");
    }
  }
}

// Count numbers up from zero when KPI cards appear (skipped for reduced motion).
export function animateCounts(root) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll(".kpi-value").forEach((el) => {
    const node = el.firstChild;
    if (!node || node.nodeType !== 3) return;
    const m = node.textContent.match(/^([^0-9-]*)(-?\d+)$/);
    if (!m) return;
    const prefix = m[1], target = Number(m[2]);
    if (!target) return;
    const t0 = performance.now(), dur = 700;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      node.textContent = prefix + Math.round(target * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
