// PDFs built in the browser with jsPDF (vendored in /vendor): the whole-project summary and the one-scenario report.
// Every result is read from API responses; nothing here computes recovery or model errors.
import { CONFIG } from "./config.js";
import { api } from "./api.js";
import { byId, monthLabel, tsrText, deltaText, rangeIdx, STATUS, disclaimerBody, anomalyText, fmtNum } from "./format.js";
import { TECH_GROUPS, PIPELINE } from "./tech.js";
import { END_USERS, ROLES, PERMISSIONS, SECURITY, SAAS } from "./platform-data.js";

const C = {
  ink: [16, 34, 43], ink2: [68, 85, 94], muted: [95, 111, 119], line: [211, 221, 218], soft: [234, 240, 238],
  accent: [11, 110, 110], accentSoft: [220, 239, 236], synthBg: [255, 241, 222], synthInk: [107, 58, 0], synthLine: [237, 200, 142],
  baseline: [42, 120, 214], scenario: [235, 104, 52], threshold: [85, 102, 110], anomaly: [244, 230, 198], gap: [226, 230, 234],
};

// The PDF's built-in Helvetica cannot draw some symbols; spell them out.
function t(s) {
  return String(s ?? "")
    .replace(/ΔTSR/g, "Delta TSR").replace(/Δ/g, "Delta ")
    .replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/−/g, "-").replace(/→/g, "->").replace(/×/g, "x").replace(/★/g, "*")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[▲▽✓✗]/g, "");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}.`));
    document.head.appendChild(s);
  });
}

async function loadJsPDF() {
  if (!window.jspdf?.jsPDF) await loadScript("vendor/jspdf.umd.min.js");
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error("The PDF library did not load.");
  if (!jsPDF.API.autoTable) await loadScript("vendor/jspdf.plugin.autotable.min.js");
  if (!jsPDF.API.autoTable) throw new Error("The PDF table plugin did not load.");
  return jsPDF;
}

/** Page writer: text, bullets, numbered headings, tables and boxes that flow across A4 pages. */
function writer(doc) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 18, CW = W - 2 * M, BOTTOM = H - 18;
  const w = { doc, W, H, M, CW, y: M, section: 0 };
  const lh = (fs, k = 1.4) => fs * 0.3528 * k;
  w.color = (rgb) => doc.setTextColor(...rgb);
  w.font = (style = "normal", size = 10) => { doc.setFont("helvetica", style); doc.setFontSize(size); };
  w.space = (h) => { if (w.y + h > BOTTOM) { doc.addPage(); w.y = M; } };
  w.dash = (on) => { if (typeof doc.setLineDashPattern === "function") doc.setLineDashPattern(on ? [1.2, 1] : [], 0); };
  w.para = (text, { size = 10, style = "normal", rgb = C.ink, indent = 0, gap = 2.2, width = CW } = {}) => {
    w.font(style, size); w.color(rgb);
    const lines = doc.splitTextToSize(t(text), width - indent);
    const h = lh(size);
    for (const ln of lines) { w.space(h); doc.text(ln, M + indent, w.y + h * 0.75); w.y += h; }
    w.y += gap;
  };
  w.bullets = (items, opts = {}) => {
    for (const it of items) {
      w.font("normal", opts.size || 10); w.color(C.ink);
      const lines = doc.splitTextToSize(t(it), CW - 6);
      const h = lh(opts.size || 10);
      w.space(h * Math.min(lines.length, 2));
      doc.setFillColor(...C.accent); doc.circle(M + 1.6, w.y + h * 0.5, 0.75, "F");
      for (const ln of lines) { w.space(h); doc.text(ln, M + 5, w.y + h * 0.75); w.y += h; }
      w.y += 1.2;
    }
    w.y += 1.5;
  };
  w.heading = (title, intro, numbered = true) => {
    if (numbered) w.section += 1;
    w.space(48);
    w.y += 3;
    w.font("bold", 14); w.color(C.accent);
    doc.text(numbered ? `${w.section}. ${t(title)}` : t(title), M, w.y + 5);
    w.y += 8;
    doc.setDrawColor(...C.line); doc.setLineWidth(0.3); doc.line(M, w.y, M + CW, w.y);
    w.y += 4;
    if (intro) w.para(intro, { rgb: C.ink2 });
  };
  w.sub = (title) => { w.space(14); w.font("bold", 11); w.color(C.ink); doc.text(t(title), M, w.y + 4); w.y += 7; };
  w.table = (head, body, opts = {}) => {
    w.space(20);
    doc.autoTable({
      startY: w.y, margin: { left: M, right: M, bottom: 20 }, head: [head.map(t)], body: body.map((r) => r.map((c) => t(c))),
      theme: "grid", styles: { font: "helvetica", fontSize: opts.fontSize || 9, cellPadding: 1.8, textColor: C.ink, lineColor: C.line, lineWidth: 0.2, valign: "top" },
      headStyles: { fillColor: C.accent, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 250, 249] },
      columnStyles: opts.columnStyles || {}, didParseCell: opts.didParseCell,
    });
    w.y = doc.lastAutoTable.finalY + 5;
  };
  w.box = (text, { bg = C.synthBg, border = C.synthLine, rgb = C.synthInk, bold } = {}) => {
    w.font("normal", 9.5);
    const lines = doc.splitTextToSize(t(text), CW - 8);
    const h = lines.length * lh(9.5) + 6 + (bold ? lh(9.5) : 0);
    w.space(h + 2);
    doc.setFillColor(...bg); doc.setDrawColor(...border); doc.setLineWidth(0.3); doc.roundedRect(M, w.y, CW, h, 2, 2, "FD");
    let yy = w.y + 3 + lh(9.5) * 0.75;
    if (bold) { w.font("bold", 9.5); w.color(rgb); doc.text(t(bold), M + 4, yy); yy += lh(9.5); }
    w.font("normal", 9.5); w.color(rgb);
    for (const ln of lines) { doc.text(ln, M + 4, yy); yy += lh(9.5); }
    w.y += h + 4;
  };
  w.cover = (kicker, title, subtitle, metaLine) => {
    doc.setFillColor(...C.ink); doc.rect(0, 0, W, 46, "F");
    w.font("bold", 9); doc.setTextColor(143, 211, 207); doc.text(t(kicker), M, 15);
    w.font("bold", 22); doc.setTextColor(255, 255, 255); doc.text(doc.splitTextToSize(t(title), CW)[0], M, 27);
    w.font("normal", 11); doc.setTextColor(216, 227, 232);
    doc.text(doc.splitTextToSize(t(subtitle), CW), M, 35);
    w.y = 54;
    w.font("normal", 9); w.color(C.ink2);
    doc.text(doc.splitTextToSize(t(metaLine), CW), M, w.y);
    w.y += 6;
  };
  w.footer = (label) => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      w.font("normal", 8); w.color(C.muted);
      doc.setDrawColor(...C.line); doc.setLineWidth(0.2); doc.line(M, H - 12, W - M, H - 12);
      doc.text(t(label), M, H - 7.5);
      doc.text(`Page ${i} of ${n}`, W - M, H - 7.5, { align: "right" });
    }
    return n;
  };
  return w;
}

const generatedOn = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const metaLine = (meta) => `Generated ${generatedOn()}  ·  dataset v${meta.dataset_version} (generator v${meta.generator_version})  ·  seed ${meta.seed}  ·  live API v${meta.api_version}`;

/** Gather all API data the project summary needs. */
async function gather(meta) {
  const sel = { ...CONFIG.DEFAULT_SELECTION };
  const demoIds = CONFIG.DEMO_SEQUENCE.filter((id) => byId(meta.scenarios, id));
  const [demo, matrices, validations, audit, forecasts, episodes] = await Promise.all([
    Promise.all(demoIds.map((scenario) => api.simulation({ ...sel, scenario }))),
    Promise.all(meta.diseases.map((d) => api.recoveryMatrix({ disease: d.id }))),
    Promise.all(meta.diseases.map((d) => api.validation({ disease: d.id }))),
    api.dataAudit(),
    Promise.all(meta.diseases.map((d) => api.forecastSummary({ disease: d.id }))),
    api.episodes({ disease: sel.disease }),
  ]);
  return { sel, demo, matrices, validations, audit, forecasts, episodes };
}

export async function exportProjectPDF(meta, onStep = () => {}) {
  onStep("Loading the PDF library…");
  const jsPDF = await loadJsPDF();
  onStep("Collecting results from the API…");
  const data = await gather(meta);
  onStep("Writing the PDF…");

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const w = writer(doc);
  const { para, bullets, heading, sub, table, box } = w;
  const end = meta.horizon.end_month;
  const dist = byId(meta.districts, data.sel.district), dis = byId(meta.diseases, data.sel.disease);
  const scenLabel = (id) => byId(meta.scenarios, id)?.label || id;
  const disName = (id) => byId(meta.diseases, id)?.name || id;

  w.cover("UKM PROJECT  ·  PROJECT SUMMARY", "EpiMetrics-Climate", "A climate-aware recovery and recurrence simulator for seasonal disease outbreaks", metaLine(meta));
  box(disclaimerBody(meta), { bold: "Synthetic data, research demonstration only." });

  heading("What the project does");
  para("Changing rainfall and temperature can trigger recurring seasonal outbreaks and stop a population from returning to its usual disease level. Most forecasting tools predict next month's case count. This project asks a different question:");
  box("When the climate shifts, how much longer does a district take to recover from an outbreak, and do secondary waves interrupt that recovery?", { bg: C.accentSoft, border: C.accentSoft, rgb: C.ink });
  para("It measures two things:");
  bullets([
    "Time to Sustained Recovery (TSR): how many months after the outbreak peak it takes until cases stay at or below the normal (endemic) level for 3 months in a row.",
    "Recovery delay (Delta TSR): TSR under a changed climate minus TSR under the baseline climate. A positive value means recovery takes longer.",
  ]);
  para("Case counts are the route to this answer, not the answer itself. The project is not a case forecasting tool, does not predict real Tamil Nadu districts, and is not clinical or public-health advice.", { rgb: C.ink2 });

  heading("How it works", `${PIPELINE.length} steps take the project from settings to reports:`);
  table(["Step", "What happens"], PIPELINE.map((p, i) => [`${i + 1}. ${p.name}`, p.detail]), { columnStyles: { 0: { cellWidth: 45, fontStyle: "bold" } } });
  para(`All scenarios use the same random numbers (seed ${meta.seed}), so any difference from the baseline is caused only by the climate change being tested. Each recovery result is also re-estimated on ${meta.replicates} noisy copies of the data to show how much it varies.`);

  heading("Data and study design");
  table(["Item", "Details"], [
    ["Data type", "Fully synthetic (computer-generated). No real surveillance or climate data."],
    ["Districts", meta.districts.map((d) => `${d.name} (${d.climate_zone})`).join(", ")],
    ["Diseases", meta.diseases.map((d) => `${d.name} (${d.vector})`).join(", ")],
    ["Period", `${monthLabel(meta.horizon.start_month)} to ${monthLabel(meta.horizon.end_month)}, monthly`],
    ["Normal levels learned from", `${monthLabel(meta.training_period.start_month)} to ${monthLabel(meta.training_period.end_month)} (baseline climate only)`],
    ["Reference outbreak", `A seeded outbreak in every series; its baseline peak (t0) falls between ${monthLabel(meta.peak_search_window.start_month)} and ${monthLabel(meta.peak_search_window.end_month)}`],
    ["Climate scenarios", `${meta.scenarios.length} (1 baseline + ${meta.scenarios.length - 1} changed climates)`],
  ], { columnStyles: { 0: { cellWidth: 52, fontStyle: "bold" } } });
  sub("Assumed climate effects (to be confirmed from literature)");
  bullets(meta.diseases.flatMap((d) => d.drivers.map((x) => `${d.name}: ${x}`)), { size: 9.5 });

  heading("Data audit", "The server re-checks the dataset the way notebook 01 does, straight from the CSV files.");
  table(["Check", "Result", "Detail"], data.audit.checks.map((c) => [c.check, c.pass ? "Pass" : "FAIL", c.detail]), {
    fontSize: 8.5, columnStyles: { 0: { cellWidth: 52, fontStyle: "bold" }, 1: { cellWidth: 16 } },
  });
  para(`The dataset catalog lists ${data.audit.catalog.length} tables. Training uses ${data.audit.split.train.rows} baseline rows (${data.audit.split.train.start} to ${data.audit.split.train.end}); testing uses ${data.audit.split.test.rows} (${data.audit.split.test.start} to ${data.audit.split.test.end}).`, { size: 9.5, rgb: C.ink2 });

  heading("Key terms", "These are project rules, chosen by the team. They are not official epidemiological standards.");
  table(["Term", "Meaning"], [
    ["Endemic threshold", meta.recovery_rule.threshold_definition],
    ["t0 (reference peak)", "The outbreak peak in the baseline series. Every scenario measures recovery from this same month."],
    ["TSR", meta.recovery_rule.tsr_definition],
    ["Delta TSR", "TSR under the scenario minus TSR under the baseline climate."],
    ["Secondary wave", meta.recovery_rule.interruption_definition],
    ["Censored", `No sustained recovery before ${monthLabel(end)}. TSR is then shown as a minimum (">= N months"), never as an invented date.`],
    ["Insufficient data", `More than ${Math.round(meta.recovery_rule.max_missing_frac * 100)}% of months after t0 are missing, so no recovery time is given.`],
  ], { columnStyles: { 0: { cellWidth: 40, fontStyle: "bold" } } });

  heading("Climate scenarios tested", "Hypothetical changes for a controlled experiment, applied to all districts. They are not climate projections.");
  table(["Scenario", "Type", "What changes"], meta.scenarios.map((s) => [s.label, s.category, s.description]), { columnStyles: { 0: { cellWidth: 44, fontStyle: "bold" }, 1: { cellWidth: 24 } } });

  const base = data.demo[0];
  heading("Worked example", `${dis.name} in ${dist.name}, the main demonstration case. Values come straight from the API.`);
  table(["Scenario", "TSR", "Delta TSR", "Interruptions", "Status"], data.demo.map((sim) => {
    const rec = sim.recovery, tt = tsrText(rec.scenario, end), d = deltaText(rec);
    return [scenLabel(sim.request.scenario), `${tt.value} ${tt.unit}`.trim(), sim.request.scenario === "baseline" ? "reference" : `${d.value} ${d.unit}`.trim(), String(rec.scenario.interruption_count), STATUS[rec.scenario.status]?.label || rec.scenario.status];
  }), { columnStyles: { 0: { fontStyle: "bold" } } });
  const bt = tsrText(base.recovery.baseline, end);
  para(`Under the baseline climate, ${dis.name.toLowerCase()} in ${dist.name} peaks in ${monthLabel(base.reference.t0_month)} and recovers after ${bt.value} ${bt.unit}.`, { size: 9.5, rgb: C.ink2, gap: 1 });
  for (const sim of data.demo.slice(1)) {
    const st = tsrText(sim.recovery.scenario, end), d = deltaText(sim.recovery);
    const n = sim.recovery.scenario.interruption_count;
    para(`With ${scenLabel(sim.request.scenario).toLowerCase()}, recovery takes ${st.value} ${st.unit} (Delta TSR ${d.value} ${d.unit}). ${n ? `${n} secondary wave${n === 1 ? "" : "s"} ${n === 1 ? "interrupts" : "interrupt"} recovery.` : "No secondary wave interrupts recovery."}`, { size: 9.5, rgb: C.ink2, gap: 1 });
  }
  w.y += 3;
  drawCaseChart(w, data.demo[1] || base, meta, 58);

  heading("Recovery delay across all districts", "Delta TSR in months for every scenario and district, estimated from the noisy case data. Negative values mean faster recovery than the baseline climate.");
  meta.diseases.forEach((d, k) => {
    const cells = data.matrices[k].cells;
    const get = (s, di) => cells.find((c) => c.scenario === s && c.district === di);
    const fmt = (c) => {
      if (!c) return "-";
      if (c.scenario === "baseline") return `TSR ${c.tsr_months ?? "-"}`;
      if (c.delta_status === "computed") return c.delta_tsr_months > 0 ? `+${c.delta_tsr_months}` : String(c.delta_tsr_months);
      if (c.delta_status === "lower_bound") return `>= +${c.delta_tsr_lower_bound_months} (not recovered)`;
      return "n/a";
    };
    sub(d.name);
    table(["Scenario", ...meta.districts.map((x) => x.name)], meta.scenarios.map((s) => [s.label, ...meta.districts.map((x) => fmt(get(s.id, x.id)))]), {
      fontSize: 8.5, columnStyles: { 0: { cellWidth: 42, fontStyle: "bold" } },
      didParseCell: (h) => {
        if (h.section !== "body" || h.column.index === 0) return;
        const v = String(h.cell.raw);
        if (v.startsWith("+") || v.startsWith(">=")) h.cell.styles.textColor = [178, 58, 49];
        else if (v.startsWith("-") && v !== "-") h.cell.styles.textColor = [11, 110, 110];
      },
    });
  });
  para("The baseline row shows each district's recovery time (in months) under the baseline climate. Red values are delays and teal values are faster recovery. Warming speeds up recovery in this model only because the districts are warmer than the assumed temperature optimum.", { size: 9, rgb: C.ink2 });

  const ep = data.episodes;
  heading("Outbreak episodes, 2015-2024", "Notebooks 06 and 07 look at every outbreak in the decade, not only the reference peak. An episode starts in a month above the threshold and recovers after 3 calm months.");
  para(`${ep.totals.episodes} episodes in 70 series: ${ep.totals.recovered} recovered and ${ep.totals.unresolved} still unresolved at the end of the data, with ${ep.totals.interruptions} recovery interruptions. ${ep.matched.matched_episodes} of ${ep.matched.climate_episodes} climate-scenario episodes (${fmtNum(ep.matched.matching_coverage_pct, 2)}%) start in the same month as a baseline episode; across the ${ep.matched.valid_delta_tsr_pairs} pairs where both recover, the mean Delta TSR is ${fmtNum(ep.matched.mean_delta_tsr_months, 2)} months.`);
  table(["Scenario", "Disease", "Episodes", "Mean recovery (mo)", "Interrupted %", "Unresolved %"], ep.by_scenario.map((r) => [scenLabel(r.scenario), disName(r.disease), String(r.episodes), fmtNum(r.mean_recovery_months, 2), fmtNum(r.interrupted_pct, 1), fmtNum(r.unresolved_pct, 1)]), {
    fontSize: 8.5, columnStyles: { 0: { cellWidth: 46, fontStyle: "bold" } },
  });
  sub("Sensitivity to the number of calm months (baseline)");
  table(["Disease", "Calm months", "Episodes", "Recovered", "Unresolved", "Mean (mo)"], ep.sensitivity.map((r) => [disName(r.disease), `${r.sustained_months}${r.is_default ? " (default)" : ""}`, String(r.total_episodes), String(r.recovered_episodes), String(r.unresolved_episodes), fmtNum(r.mean_recovery_months, 2)]), { fontSize: 8.5 });
  para(`Unit tests of the episode function, run on the server: ${ep.unit_tests.map((u) => `${u.name} ${u.pass ? "passed" : "FAILED"}`).join("; ")}.`, { size: 9, rgb: C.ink2 });

  heading("Forecast models (benchmarks)", "Notebooks 03-05 test six ways to forecast monthly cases on 2022-2024. They are benchmarks: the project's outcome is recovery time, not case counts.");
  meta.diseases.forEach((d, k) => {
    const fs = data.forecasts[k];
    sub(`${d.name}: mean absolute error (cases per 100,000)`);
    table(["District", ...fs.models.map((m) => m.label)], [
      ...fs.districts.map((r) => [byId(meta.districts, r.district)?.name || r.district, ...fs.models.map((m) => fmtNum(r[m.id], 3))]),
      ["All districts (pooled)", ...fs.models.map((m) => fmtNum(fs.pooled.find((p) => p.id === m.id)?.mae, 3))],
    ], { fontSize: 7.5, columnStyles: { 0: { cellWidth: 30, fontStyle: "bold" } } });
  });
  para("Every model misses most in outbreak months, which is exactly where recovery is decided. Adding climate inputs helps some series, but no model removes the outbreak error, so the project measures recovery directly.", { size: 9, rgb: C.ink2 });

  heading("How reliable are the estimates?", "Because the data is synthetic, the true recovery time of every series is known. The recovery engine's estimates from noisy data are compared with that truth.");
  const maskLabel = (id) => meta.masks.find((m) => m.id === (id ?? "none"))?.label || String(id);
  meta.diseases.forEach((d, k) => {
    const v = data.validations[k];
    sub(d.name);
    table(["Missing-data test", "Average error", "Status matches truth", "Series compared", "Insufficient data"], v.summary_by_mask.map((s) => [
      maskLabel(s.mask), s.mae_months == null ? "-" : `${s.mae_months} months`, `${Math.round(s.status_agreement * 100)}%`, `${s.n_compared} of ${s.n_series}`, String(s.n_insufficient_data),
    ]), { fontSize: 8.5, columnStyles: { 0: { cellWidth: 48, fontStyle: "bold" } } });
    const def = v.sensitivity.find((x) => x.is_default);
    const best = [...v.sensitivity].filter((x) => x.mae_months != null).sort((a, b) => a.mae_months - b.mae_months)[0];
    if (def && best) para(`Default rule (${def.window_months} months, threshold x ${def.threshold_factor}): average error ${def.mae_months} months. Across the ${v.sensitivity.length} rule variants tested, the lowest average error is ${best.mae_months} months (${best.window_months} months, x ${best.threshold_factor}).`, { size: 9, rgb: C.ink2 });
  });
  para('The 9-month reporting outage is designed to exceed the missing-data limit, so the engine correctly answers "insufficient data" instead of guessing.', { size: 9, rgb: C.ink2 });

  heading("Limitations");
  bullets(meta.limitations, { size: 9.5 });

  heading("Who will use it", "The simulator is for planning and research, not for diagnosing patients or forecasting real cases.");
  table(["End user", "What they would use it for"], END_USERS.map((u) => [u.name, u.task]), { columnStyles: { 0: { cellWidth: 62, fontStyle: "bold" } } });

  heading("Delivery as a service (SaaS)", SAAS.summary);
  table(["Layer", "What it does"], SAAS.layers.map((l) => [l.name, l.detail]), { columnStyles: { 0: { cellWidth: 45, fontStyle: "bold" } } });
  table(["Tier", "For", "Includes", "Price"], SAAS.tiers.map((x) => [x.name, x.who, x.includes, x.price]), { fontSize: 8.5, columnStyles: { 0: { cellWidth: 34, fontStyle: "bold" } } });
  bullets(SAAS.delivery, { size: 9.5 });

  heading("Security", "\"Working now\" means the FastAPI backend and website do it in this version; \"At deployment\" needs a production host.");
  table(["Area", "Measure", "Status"], SECURITY.map((m) => [m.area, m.measure, m.status === "app" ? "Working now" : "At deployment"]), { fontSize: 8.5, columnStyles: { 0: { cellWidth: 32, fontStyle: "bold" }, 2: { cellWidth: 24 } } });
  sub("What each role can do");
  table(["Action", ...Object.values(ROLES).map((r) => r.label)], PERMISSIONS.map((p) => [p.what, ...Object.keys(ROLES).map((k) => (p[k] ? "Yes" : "No"))]), { fontSize: 8.5, columnStyles: { 0: { cellWidth: 90 } } });

  heading("Assistant", "A basic chat assistant answers questions inside the app.");
  bullets([
    "Answers what the measures mean (TSR, Delta TSR, threshold, secondary wave, censored) from the project's own definitions.",
    "Explains results for a district, disease and scenario by reading the API, for example why recovery takes longer under a delayed monsoon.",
    "Reports the best forecast model and the outbreak-episode totals from the analytics endpoints.",
    "Uses no AI service and no internet, so it cannot invent numbers. It refuses medical questions.",
  ], { size: 9.5 });

  heading("Technology used", "What each part of the project is built with, and why.");
  for (const g of TECH_GROUPS) {
    sub(g.title);
    table(["Technology", "What it is used for", "Where"], g.items.map((it) => [it.name, it.used, it.where]), {
      fontSize: 8.5, columnStyles: { 0: { cellWidth: 36, fontStyle: "bold" }, 2: { cellWidth: 38, textColor: C.ink2 } },
    });
  }

  const n = w.footer("EpiMetrics-Climate  ·  synthetic data, research demonstration only  ·  not a forecast or clinical advice");
  doc.save(`EpiMetrics-Climate_project_summary_v${meta.dataset_version}.pdf`);
  return n;
}

/** One-scenario report: title, disclaimer, summary, results, case chart, waves, anomaly, method, limitations, provenance. */
export async function exportReportPDF(sim, meta, summary) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const w = writer(doc);
  const { para, bullets, heading, table, box } = w;
  const r = sim.request, end = meta.horizon.end_month;
  const scen = byId(meta.scenarios, r.scenario), dist = byId(meta.districts, r.district), dis = byId(meta.diseases, r.disease);
  const mask = byId(meta.masks, r.mask || "none");
  const isBase = r.scenario === "baseline";
  const rec = sim.recovery;

  w.cover("EPIMETRICS-CLIMATE  ·  SCENARIO REPORT", `${scen.label}: ${dis.name} in ${dist.name}`,
    `Recovery under a hypothetical climate scenario${mask && mask.id !== "none" ? `, reporting completeness: ${mask.label}` : ""}`, metaLine(meta));
  box(disclaimerBody(meta), { bold: "Synthetic data, research demonstration only." });

  heading("Summary", null, false);
  para(summary, { size: 10.5 });

  heading("Recovery results", null, false);
  const b = tsrText(rec.baseline, end), s = tsrText(rec.scenario, end), d = deltaText(rec);
  const spread = (blk) => (blk.uncertainty?.p10_months != null ? `${fmtNum(blk.uncertainty.p10_months, 1)}-${fmtNum(blk.uncertainty.p90_months, 1)} months` : "not available");
  const rows = [
    ["Time to sustained recovery", `${b.value} ${b.unit}`.trim(), `${s.value} ${s.unit}`.trim()],
    ["Recovery month (confirmed)", `${monthLabel(rec.baseline.recovery_month)} (${monthLabel(rec.baseline.recovery_confirmed_month)})`, `${monthLabel(rec.scenario.recovery_month)} (${monthLabel(rec.scenario.recovery_confirmed_month)})`],
    ["Status", STATUS[rec.baseline.status]?.label || rec.baseline.status, STATUS[rec.scenario.status]?.label || rec.scenario.status],
    ["Interruptions before recovery", String(rec.baseline.interruption_count), String(rec.scenario.interruption_count)],
    ["Months above threshold after t0", String(rec.baseline.months_above_threshold), String(rec.scenario.months_above_threshold)],
    [`Spread across ${meta.replicates} replicates (p10-p90)`, spread(rec.baseline), spread(rec.scenario)],
  ];
  table(["Measure", "Baseline climate", ...(isBase ? [] : [scen.label])], rows.map((x) => (isBase ? x.slice(0, 2) : x)), { columnStyles: { 0: { cellWidth: 62, fontStyle: "bold" } } });
  box(`Recovery delay (Delta TSR): ${d.value} ${d.unit}. ${d.note}.`, { bg: C.accentSoft, border: C.accentSoft, rgb: C.ink });

  heading("Cases, threshold and recovery", null, false);
  drawCaseChart(w, sim, meta, 70);

  heading("Secondary waves", null, false);
  const waves = [...sim.waves.baseline.map((x) => ({ ...x, who: "Baseline" })), ...(isBase ? [] : sim.waves.scenario.map((x) => ({ ...x, who: scen.label })))];
  if (waves.length) table(["Series", "Onset", "Peak", "Peak cases", "Effect"], waves.map((x) => [x.who, monthLabel(x.onset_month), monthLabel(x.peak_month), x.peak_cases == null ? "-" : String(x.peak_cases), x.interrupts_recovery ? "Interrupts recovery" : "After recovery"]), { fontSize: 9 });
  else para(`No secondary waves were detected after the reference peak in ${isBase ? "the baseline" : "either series"}.`, { rgb: C.ink2 });

  heading("Climate anomaly applied", null, false);
  if (sim.anomaly_windows.length) bullets(sim.anomaly_windows.map(anomalyText), { size: 9.5 });
  else para("No anomaly: this is the generated baseline climate.", { rgb: C.ink2 });
  para(`${scen.description}. Hypothetical input for a controlled experiment, not a climate projection for Tamil Nadu.`, { size: 9, rgb: C.ink2 });

  heading("Method and definitions", null, false);
  bullets([
    `Reference peak t0: ${monthLabel(sim.reference.t0_month)}, the outbreak peak in the baseline series. Shared by every scenario.`,
    `Endemic threshold: ${meta.recovery_rule.threshold_definition}.`,
    `TSR: ${meta.recovery_rule.tsr_definition}.`,
    `Secondary wave: ${meta.recovery_rule.interruption_definition}.`,
    `Censored series (no recovery by ${monthLabel(end)}) report a lower bound, never an invented date.`,
    ...(mask && mask.id !== "none" ? [`Reporting completeness "${mask.label}": ${mask.description}. Missing months stay empty; the threshold is re-estimated from the remaining baseline months.`] : []),
  ], { size: 9.5 });

  heading("Limitations", null, false);
  bullets(meta.limitations, { size: 9 });

  heading("Provenance", null, false);
  table(["Item", "Value"], [
    ["Source", `${sim.provenance.source} FastAPI backend, API v${sim.api_version}`],
    ["Dataset", `v${sim.dataset_version}, generator v${sim.provenance.generator_version}, seed ${sim.provenance.seed}`],
    ["Recovery rule", sim.provenance.recovery_rule],
    ["Computed from", sim.provenance.generated_from],
    ["Request", `district=${r.district} disease=${r.disease} scenario=${r.scenario} mask=${r.mask || "none"}`],
    ["Generated", new Date().toISOString()],
  ], { fontSize: 8.5, columnStyles: { 0: { cellWidth: 36, fontStyle: "bold" } } });

  const n = w.footer("EpiMetrics-Climate scenario report  ·  synthetic data, research demonstration only  ·  not a forecast or clinical advice");
  doc.save(`epimetrics_report_${r.district}_${r.disease}_${r.scenario}${r.mask ? `_${r.mask}` : ""}_v${sim.dataset_version}.pdf`);
  return n;
}

/** Baseline vs scenario cases with threshold, t0, recovery months and missing months, drawn as vector lines. */
function drawCaseChart(w, sim, meta, h) {
  const { doc, M: x, CW: width } = w;
  w.space(h + 22);
  let y = w.y;
  const isBase = sim.request.scenario === "baseline";
  const scen = byId(meta.scenarios, sim.request.scenario);
  w.font("bold", 10); w.color(C.ink);
  doc.text(t(isBase ? "Monthly cases: baseline climate" : `Monthly cases: baseline vs ${scen.label.toLowerCase()}`), x, y + 4);
  y += 8;
  const [i0, i1] = rangeIdx(sim.months, CONFIG.FOCUS_RANGE.start, CONFIG.FOCUS_RANGE.end);
  const B = sim.series.baseline.observed_cases, S = sim.series.scenario.observed_cases, T = sim.threshold_cases;
  const vis = [...B.slice(i0, i1 + 1), ...S.slice(i0, i1 + 1), ...T.slice(i0, i1 + 1)].filter((v) => v != null);
  const raw = Math.max(...vis, 1);
  const p = 10 ** Math.floor(Math.log10(raw / 4)), f = raw / 4 / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const top = Math.ceil(raw / step) * step;
  const L = x + 14, R = x + width, Tp = y + 2, Bt = y + h;
  const n = i1 - i0 + 1, cw = (R - L) / n;
  const X = (i) => L + (i - i0 + 0.5) * cw, Y = (v) => Bt - (v / top) * (Bt - Tp);

  for (const a of sim.anomaly_windows) {
    const s = Math.max(sim.months.indexOf(a.start_month), i0), e = Math.min(sim.months.indexOf(a.end_month), i1);
    if (s >= 0 && e >= s) { doc.setFillColor(...C.anomaly); doc.rect(X(s) - cw / 2, Tp, (e - s + 1) * cw, Bt - Tp, "F"); }
  }
  let gaps = 0;
  for (let i = i0; i <= i1; i++) {
    if (B[i] == null || S[i] == null) { gaps += 1; doc.setFillColor(...C.gap); doc.rect(X(i) - cw / 2, Tp, cw, Bt - Tp, "F"); }
  }
  w.font("normal", 7); w.color(C.muted);
  doc.setDrawColor(...C.line); doc.setLineWidth(0.15);
  for (let v = 0; v <= top + 1e-9; v += step) { doc.line(L, Y(v), R, Y(v)); doc.text(Math.round(v).toLocaleString("en-IN"), L - 2, Y(v) + 1, { align: "right" }); }
  for (let i = i0; i <= i1; i++) if (sim.months[i].endsWith("-01") || sim.months[i].endsWith("-07")) doc.text(monthLabel(sim.months[i], "short"), X(i), Bt + 4, { align: "center" });

  const poly = (arr, rgb, lw) => {
    doc.setDrawColor(...rgb); doc.setLineWidth(lw);
    for (let i = i0; i < i1; i++) if (arr[i] != null && arr[i + 1] != null) doc.line(X(i), Y(arr[i]), X(i + 1), Y(arr[i + 1]));
  };
  w.dash(true); doc.setDrawColor(...C.threshold); doc.setLineWidth(0.3);
  for (let i = i0; i <= i1; i++) {
    if (T[i] == null) continue;
    doc.line(X(i) - cw / 2, Y(T[i]), X(i) + cw / 2, Y(T[i]));
    if (i < i1 && T[i + 1] != null) doc.line(X(i) + cw / 2, Y(T[i]), X(i) + cw / 2, Y(T[i + 1]));
  }
  const vline = (m, rgb, label, row) => {
    const i = sim.months.indexOf(m); if (i < i0 || i > i1) return;
    doc.setDrawColor(...rgb); doc.setLineWidth(0.35); doc.line(X(i), Tp, X(i), Bt);
    w.font("bold", 6.5); w.color(C.ink2); doc.text(t(label), X(i) + 1, Tp + 3 + row * 3.2);
  };
  if (sim.reference.t0_month) vline(sim.reference.t0_month, C.ink2, "t0 peak", 0);
  w.dash(false);
  poly(B, C.baseline, 0.6);
  if (!isBase) poly(S, C.scenario, 0.6);
  w.dash(true);
  if (sim.recovery.baseline.recovery_month) vline(sim.recovery.baseline.recovery_month, C.baseline, "Baseline recovers", 1);
  if (!isBase && sim.recovery.scenario.recovery_month) vline(sim.recovery.scenario.recovery_month, C.scenario, "Scenario recovers", 2);
  w.dash(false);
  for (const wv of isBase ? sim.waves.baseline : sim.waves.scenario) {
    const i = sim.months.indexOf(wv.peak_month), arr = isBase ? B : S;
    if (i >= i0 && i <= i1 && arr[i] != null) { doc.setFillColor(...(isBase ? C.baseline : C.scenario)); doc.circle(X(i), Y(arr[i]), 0.9, "F"); }
  }
  let ly = Bt + 9, lx = x;
  const key = (rgb, label, dashed) => {
    w.dash(!!dashed); doc.setDrawColor(...rgb); doc.setLineWidth(0.6); doc.line(lx, ly - 1, lx + 6, ly - 1); w.dash(false);
    w.font("normal", 7.5); w.color(C.ink2); doc.text(t(label), lx + 8, ly); lx += 10 + doc.getTextWidth(t(label)) + 4;
  };
  key(C.baseline, "Baseline cases");
  if (!isBase) key(C.scenario, "Scenario cases");
  key(C.threshold, "Endemic threshold", true);
  const swatch = (rgb, label) => { doc.setFillColor(...rgb); doc.rect(lx, ly - 2.6, 5, 3, "F"); w.font("normal", 7.5); w.color(C.ink2); doc.text(t(label), lx + 7, ly); lx += 9 + doc.getTextWidth(t(label)) + 4; };
  if (sim.anomaly_windows.length) swatch(C.anomaly, "Climate anomaly");
  if (gaps) swatch(C.gap, "No reported cases");
  doc.setFillColor(...C.scenario); doc.circle(lx + 1, ly - 1, 0.9, "F"); doc.text("Secondary-wave peak", lx + 4, ly);
  w.y = ly + 6;
}
