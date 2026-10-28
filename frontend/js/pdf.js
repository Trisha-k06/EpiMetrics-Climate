// Whole-project summary PDF, built in the browser with jsPDF (vendored in /vendor).
// Every result is read from API responses; nothing here computes recovery.
import { CONFIG } from "./config.js";
import { api } from "./api.js";
import { byId, monthLabel, tsrText, deltaText, rangeIdx, STATUS, disclaimerBody } from "./format.js";
import { TECH_GROUPS, PIPELINE } from "./tech.js";

const C = {
  ink: [16, 34, 43], ink2: [68, 85, 94], muted: [95, 111, 119], line: [211, 221, 218], soft: [234, 240, 238],
  accent: [11, 110, 110], accentSoft: [220, 239, 236], synthBg: [255, 241, 222], synthInk: [107, 58, 0], synthLine: [237, 200, 142],
  baseline: [42, 120, 214], scenario: [235, 104, 52], threshold: [85, 102, 110], anomaly: [244, 230, 198],
};

// The PDF's built-in Helvetica cannot draw some symbols; spell them out.
function t(s) {
  return String(s ?? "")
    .replace(/ΔTSR/g, "Delta TSR").replace(/Δ/g, "Delta ")
    .replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/−/g, "-").replace(/→/g, "->")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
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

/** Gather all API data the summary needs. */
async function gather(meta) {
  const sel = { ...CONFIG.DEFAULT_SELECTION };
  const demoIds = CONFIG.DEMO_SEQUENCE.filter((id) => byId(meta.scenarios, id));
  const [demo, matrices, validations] = await Promise.all([
    Promise.all(demoIds.map((scenario) => api.simulation({ ...sel, scenario }))),
    Promise.all(meta.diseases.map((d) => api.recoveryMatrix({ disease: d.id }))),
    Promise.all(meta.diseases.map((d) => api.validation({ disease: d.id }))),
  ]);
  return { sel, demo, matrices, validations };
}

export async function exportProjectPDF(meta, onStep = () => {}) {
  onStep("Loading the PDF library…");
  const jsPDF = await loadJsPDF();
  onStep("Collecting results from the API…");
  const data = await gather(meta);
  onStep("Writing the PDF…");

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 18, CW = W - 2 * M, BOTTOM = H - 18;
  let y = M;
  let section = 0;

  const lh = (fs, k = 1.4) => fs * 0.3528 * k;
  const color = (rgb) => doc.setTextColor(...rgb);
  const font = (style = "normal", size = 10) => { doc.setFont("helvetica", style); doc.setFontSize(size); };
  const space = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };
  const dash = (on) => { if (typeof doc.setLineDashPattern === "function") doc.setLineDashPattern(on ? [1.2, 1] : [], 0); };

  function para(text, { size = 10, style = "normal", rgb = C.ink, indent = 0, gap = 2.2, width = CW } = {}) {
    font(style, size); color(rgb);
    const lines = doc.splitTextToSize(t(text), width - indent);
    const h = lh(size);
    for (const ln of lines) { space(h); doc.text(ln, M + indent, y + h * 0.75); y += h; }
    y += gap;
  }
  function bullets(items, opts = {}) {
    for (const it of items) {
      font("normal", opts.size || 10); color(C.ink);
      const lines = doc.splitTextToSize(t(it), CW - 6);
      const h = lh(opts.size || 10);
      space(h * Math.min(lines.length, 2));
      doc.setFillColor(...C.accent); doc.circle(M + 1.6, y + h * 0.5, 0.75, "F");
      for (const ln of lines) { space(h); doc.text(ln, M + 5, y + h * 0.75); y += h; }
      y += 1.2;
    }
    y += 1.5;
  }
  function heading(title, intro) {
    section += 1;
    space(48);
    y += 3;
    font("bold", 14); color(C.accent);
    doc.text(`${section}. ${t(title)}`, M, y + 5);
    y += 8;
    doc.setDrawColor(...C.line); doc.setLineWidth(0.3); doc.line(M, y, M + CW, y);
    y += 4;
    if (intro) para(intro, { rgb: C.ink2 });
  }
  function sub(title) { space(14); font("bold", 11); color(C.ink); doc.text(t(title), M, y + 4); y += 7; }
  function table(head, body, opts = {}) {
    space(20);
    doc.autoTable({
      startY: y, margin: { left: M, right: M, bottom: 20 }, head: [head.map(t)], body: body.map((r) => r.map(t)),
      theme: "grid", styles: { font: "helvetica", fontSize: opts.fontSize || 9, cellPadding: 1.8, textColor: C.ink, lineColor: C.line, lineWidth: 0.2, valign: "top" },
      headStyles: { fillColor: C.accent, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 250, 249] },
      columnStyles: opts.columnStyles || {}, didParseCell: opts.didParseCell,
    });
    y = doc.lastAutoTable.finalY + 5;
  }
  function box(text, { bg = C.synthBg, border = C.synthLine, rgb = C.synthInk, bold } = {}) {
    font("normal", 9.5);
    const lines = doc.splitTextToSize(t(text), CW - 8);
    const h = lines.length * lh(9.5) + 6 + (bold ? lh(9.5) : 0);
    space(h + 2);
    doc.setFillColor(...bg); doc.setDrawColor(...border); doc.setLineWidth(0.3); doc.roundedRect(M, y, CW, h, 2, 2, "FD");
    let yy = y + 3 + lh(9.5) * 0.75;
    if (bold) { font("bold", 9.5); color(rgb); doc.text(t(bold), M + 4, yy); yy += lh(9.5); }
    font("normal", 9.5); color(rgb);
    for (const ln of lines) { doc.text(ln, M + 4, yy); yy += lh(9.5); }
    y += h + 4;
  }

  const end = meta.horizon.end_month;
  const dist = byId(meta.districts, data.sel.district), dis = byId(meta.diseases, data.sel.disease);
  const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // ---------- cover ----------
  doc.setFillColor(...C.ink); doc.rect(0, 0, W, 46, "F");
  font("bold", 9); doc.setTextColor(143, 211, 207); doc.text("UKM PROJECT  ·  PROJECT SUMMARY", M, 15);
  font("bold", 24); doc.setTextColor(255, 255, 255); doc.text("EpiMetrics-Climate", M, 27);
  font("normal", 11.5); doc.setTextColor(216, 227, 232);
  doc.text(doc.splitTextToSize("A climate-aware recovery and recurrence simulator for seasonal disease outbreaks", CW), M, 35);
  y = 54;
  font("normal", 9); color(C.ink2);
  doc.text(t(`Generated ${generated}  ·  dataset v${meta.dataset_version} (generator v${meta.generator_version})  ·  seed ${meta.seed}  ·  ${CONFIG.API_MODE === "mock" ? "mock API" : "live API"} v${meta.api_version}`), M, y);
  y += 6;
  box(disclaimerBody(meta), { bold: "Synthetic data, research demonstration only." });

  // ---------- 1 what it does ----------
  heading("What the project does");
  para("Changing rainfall and temperature can trigger recurring seasonal outbreaks and stop a population from returning to its usual disease level. Most forecasting tools predict next month's case count. This project asks a different question:");
  box("When the climate shifts, how much longer does a district take to recover from an outbreak, and do secondary waves interrupt that recovery?", { bg: C.accentSoft, border: C.accentSoft, rgb: C.ink });
  para("It measures two things:");
  bullets([
    "Time to Sustained Recovery (TSR): how many months after the outbreak peak it takes until cases stay at or below the normal (endemic) level for 3 months in a row.",
    "Recovery delay (Delta TSR): TSR under a changed climate minus TSR under the baseline climate. A positive value means recovery takes longer.",
  ]);
  para("Case counts are the route to this answer, not the answer itself. The project is not a case forecasting tool, does not predict real Tamil Nadu districts, and is not clinical or public-health advice.", { rgb: C.ink2 });

  // ---------- 2 how it works ----------
  heading("How it works", "Seven steps take the project from settings to reports:");
  table(["Step", "What happens"], PIPELINE.map((p, i) => [`${i + 1}. ${p.name}`, p.detail]), { columnStyles: { 0: { cellWidth: 45, fontStyle: "bold" } } });
  para(`All scenarios use the same random numbers (seed ${meta.seed}), so any difference from the baseline is caused only by the climate change being tested. Each recovery result is also re-estimated on ${meta.replicates} noisy copies of the data to show how much it varies.`);

  // ---------- 3 data ----------
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

  // ---------- 4 definitions ----------
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

  // ---------- 5 scenarios ----------
  heading("Climate scenarios tested", "Hypothetical changes for a controlled experiment, applied to all districts. They are not climate projections.");
  table(["Scenario", "Type", "What changes"], meta.scenarios.map((s) => [s.label, s.category, s.description]), { columnStyles: { 0: { cellWidth: 44, fontStyle: "bold" }, 1: { cellWidth: 24 } } });

  // ---------- 6 demo ----------
  const base = data.demo[0];
  heading("Worked example", `${dis.name} in ${dist.name}, the main demonstration case. Values come straight from the API.`);
  table(["Scenario", "TSR", "Delta TSR", "Interruptions", "Status"], data.demo.map((sim) => {
    const s = byId(meta.scenarios, sim.request.scenario);
    const rec = sim.recovery, tt = tsrText(rec.scenario, end), d = deltaText(rec);
    return [s.label, `${tt.value} ${tt.unit}`.trim(), sim.request.scenario === "baseline" ? "reference" : `${d.value} ${d.unit}`.trim(), String(rec.scenario.interruption_count), STATUS[rec.scenario.status]?.label || rec.scenario.status];
  }), { columnStyles: { 0: { fontStyle: "bold" } } });
  const bt = tsrText(base.recovery.baseline, end);
  para(`Under the baseline climate, ${dis.name.toLowerCase()} in ${dist.name} peaks in ${monthLabel(base.reference.t0_month)} and recovers after ${bt.value} ${bt.unit}.`, { size: 9.5, rgb: C.ink2, gap: 1 });
  for (const sim of data.demo.slice(1)) {
    const s = byId(meta.scenarios, sim.request.scenario), st = tsrText(sim.recovery.scenario, end), d = deltaText(sim.recovery);
    const n = sim.recovery.scenario.interruption_count;
    para(`With ${s.label.toLowerCase()}, recovery takes ${st.value} ${st.unit} (Delta TSR ${d.value} ${d.unit}). ${n ? `${n} secondary wave${n === 1 ? "" : "s"} ${n === 1 ? "interrupts" : "interrupt"} recovery.` : "No secondary wave interrupts recovery."}`, { size: 9.5, rgb: C.ink2, gap: 1 });
  }
  y += 3;
  const chartSim = data.demo[1] || base;
  drawCaseChart(doc, chartSim, meta, { x: M, w: CW, h: 58, getY: () => y, setY: (v) => (y = v), space, font, color, dash, t });

  // ---------- 7 matrix ----------
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

  // ---------- 8 validation ----------
  heading("How reliable are the estimates?", "Because the data is synthetic, the true recovery time of every series is known. The recovery engine's estimates from noisy data are compared with that truth.");
  const maskLabel = (id) => meta.masks.find((m) => (m.id ?? null) === (id ?? null))?.label || String(id);
  meta.diseases.forEach((d, k) => {
    const v = data.validations[k];
    sub(d.name);
    table(["Missing-data test", "Average error", "Status matches truth", "Series compared", "Insufficient data"], v.summary_by_mask.map((s) => [
      maskLabel(s.mask), s.mae_months == null ? "-" : `${s.mae_months} months`, `${Math.round(s.status_agreement * 100)}%`, `${s.n_compared} of ${s.n_series}`, String(s.n_insufficient_data),
    ]), { fontSize: 8.5, columnStyles: { 0: { cellWidth: 48, fontStyle: "bold" } } });
    const def = v.sensitivity.find((x) => x.is_default);
    const best = [...v.sensitivity].sort((a, b) => a.mae_months - b.mae_months)[0];
    if (def && best) para(`Default rule (${def.window_months} months, threshold x ${def.threshold_factor}): average error ${def.mae_months} months. Across the ${v.sensitivity.length} rule variants tested, the lowest average error is ${best.mae_months} months (${best.window_months} months, x ${best.threshold_factor}).`, { size: 9, rgb: C.ink2 });
  });
  para('The 9-month reporting outage is designed to exceed the missing-data limit, so the engine correctly answers "insufficient data" instead of guessing.', { size: 9, rgb: C.ink2 });

  // ---------- 9 limitations ----------
  heading("Limitations");
  bullets(meta.limitations, { size: 9.5 });

  // ---------- 10 technology ----------
  heading("Technology used", "What each part of the project is built with, and why.");
  for (const g of TECH_GROUPS) {
    sub(g.title);
    table(["Technology", "What it is used for", "Where"], g.items.map((it) => [it.name, it.used, it.where]), {
      fontSize: 8.5, columnStyles: { 0: { cellWidth: 36, fontStyle: "bold" }, 2: { cellWidth: 38, textColor: C.ink2 } },
    });
  }

  // ---------- footer on every page ----------
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    font("normal", 8); color(C.muted);
    doc.setDrawColor(...C.line); doc.setLineWidth(0.2); doc.line(M, H - 12, W - M, H - 12);
    doc.text("EpiMetrics-Climate  ·  synthetic data, research demonstration only  ·  not a forecast or clinical advice", M, H - 7.5);
    doc.text(`Page ${i} of ${n}`, W - M, H - 7.5, { align: "right" });
  }
  doc.save(`EpiMetrics-Climate_project_summary_v${meta.dataset_version}.pdf`);
  return n;
}

/** Baseline vs scenario cases with threshold, t0 and recovery months, drawn as vector lines. */
function drawCaseChart(doc, sim, meta, { x, w, h, getY, setY, space, font, color, dash, t: tt }) {
  space(h + 22);
  let y = getY();
  const scen = byId(meta.scenarios, sim.request.scenario);
  font("bold", 10); color(C.ink);
  doc.text(tt(`Monthly cases: baseline vs ${scen.label.toLowerCase()}`), x, y + 4);
  y += 8;
  const [i0, i1] = rangeIdx(sim.months, CONFIG.FOCUS_RANGE.start, CONFIG.FOCUS_RANGE.end);
  const B = sim.series.baseline.observed_cases, S = sim.series.scenario.observed_cases, T = sim.threshold_cases;
  const vis = [...B.slice(i0, i1 + 1), ...S.slice(i0, i1 + 1), ...T.slice(i0, i1 + 1)];
  const raw = Math.max(...vis, 1);
  const p = 10 ** Math.floor(Math.log10(raw / 4)), f = raw / 4 / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const top = Math.ceil(raw / step) * step;
  const L = x + 14, R = x + w, Tp = y + 2, Bt = y + h;
  const n = i1 - i0 + 1, cw = (R - L) / n;
  const X = (i) => L + (i - i0 + 0.5) * cw, Y = (v) => Bt - (v / top) * (Bt - Tp);

  for (const a of sim.anomaly_windows) {
    const s = Math.max(sim.months.indexOf(a.start_month), i0), e = Math.min(sim.months.indexOf(a.end_month), i1);
    if (s >= 0 && e >= s) { doc.setFillColor(...C.anomaly); doc.rect(X(s) - cw / 2, Tp, (e - s + 1) * cw, Bt - Tp, "F"); }
  }
  font("normal", 7); color(C.muted);
  doc.setDrawColor(...C.line); doc.setLineWidth(0.15);
  for (let v = 0; v <= top + 1e-9; v += step) { doc.line(L, Y(v), R, Y(v)); doc.text(Math.round(v).toLocaleString("en-IN"), L - 2, Y(v) + 1, { align: "right" }); }
  for (let i = i0; i <= i1; i++) if (sim.months[i].endsWith("-01") || sim.months[i].endsWith("-07")) doc.text(monthLabel(sim.months[i], "short"), X(i), Bt + 4, { align: "center" });

  const poly = (arr, rgb, width) => {
    doc.setDrawColor(...rgb); doc.setLineWidth(width);
    for (let i = i0; i < i1; i++) if (arr[i] != null && arr[i + 1] != null) doc.line(X(i), Y(arr[i]), X(i + 1), Y(arr[i + 1]));
  };
  dash(true); doc.setDrawColor(...C.threshold); doc.setLineWidth(0.3);
  for (let i = i0; i <= i1; i++) { doc.line(X(i) - cw / 2, Y(T[i]), X(i) + cw / 2, Y(T[i])); if (i < i1) doc.line(X(i) + cw / 2, Y(T[i]), X(i) + cw / 2, Y(T[i + 1])); }
  const vline = (m, rgb, label, row) => {
    const i = sim.months.indexOf(m); if (i < i0 || i > i1) return;
    doc.setDrawColor(...rgb); doc.setLineWidth(0.35); doc.line(X(i), Tp, X(i), Bt);
    font("bold", 6.5); color(C.ink2); doc.text(tt(label), X(i) + 1, Tp + 3 + row * 3.2);
  };
  vline(sim.reference.t0_month, C.ink2, "t0 peak", 0);
  dash(false);
  poly(B, C.baseline, 0.6);
  if (sim.request.scenario !== "baseline") poly(S, C.scenario, 0.6);
  dash(true);
  if (sim.recovery.baseline.recovery_month) vline(sim.recovery.baseline.recovery_month, C.baseline, "Baseline recovers", 1);
  if (sim.request.scenario !== "baseline" && sim.recovery.scenario.recovery_month) vline(sim.recovery.scenario.recovery_month, C.scenario, "Scenario recovers", 2);
  dash(false);
  for (const wv of sim.waves.scenario) {
    const i = sim.months.indexOf(wv.peak_month);
    if (i >= i0 && i <= i1) { doc.setFillColor(...C.scenario); doc.circle(X(i), Y(S[i]), 0.9, "F"); }
  }
  // legend
  let ly = Bt + 9, lx = x;
  const key = (rgb, label, dashed) => {
    dash(!!dashed); doc.setDrawColor(...rgb); doc.setLineWidth(0.6); doc.line(lx, ly - 1, lx + 6, ly - 1); dash(false);
    font("normal", 7.5); color(C.ink2); doc.text(tt(label), lx + 8, ly); lx += 10 + doc.getTextWidth(tt(label)) + 4;
  };
  key(C.baseline, "Baseline cases"); key(C.scenario, "Scenario cases"); key(C.threshold, "Endemic threshold", true);
  doc.setFillColor(...C.anomaly); doc.rect(lx, ly - 2.6, 5, 3, "F"); font("normal", 7.5); color(C.ink2); doc.text("Climate anomaly", lx + 7, ly); lx += 30;
  doc.setFillColor(...C.scenario); doc.circle(lx + 1, ly - 1, 0.9, "F"); doc.text("Secondary-wave peak", lx + 4, ly);
  setY(ly + 6);
}
