// Scenario simulator. Viewers get the simple version (one big plain-language answer, one chart, details behind "i");
// analysts get the full tool with an Advanced disclosure, month drill-down, saved views and team comments.
import { CONFIG } from "../config.js";
import { api, track } from "../api.js";
import { can } from "../auth.js";
import { getSelection, setSelection, onSelection } from "../state.js";
import { esc, monthLabel, byId, tsrText, deltaText, plural, STATUS } from "../format.js";
import { selectorsHTML, scenarioSelectHTML, maskSelectHTML, bindSelects, scenarioPickerHTML, bindScenarioPicker, kpiCardsHTML, renderSimulationView,
  dataTableHTML, anomalyListHTML, loadingHTML, errorHTML, animateCounts, screenEyebrow, monthDetailHTML } from "../ui.js";
import { infoTip } from "../components/tooltip.js";
import { crumbsHTML, bindCrumbs } from "../components/breadcrumbs.js";
import { mountComments, viewKey } from "../components/comments.js";
import { mountSaveView, mountPin } from "../components/saved.js";
import { mountInsights } from "../components/insights.js";

/** One plain-language sentence answering the screen's question, from the API values. */
export function answerText(sim, meta) {
  const r = sim.request, rec = sim.recovery, end = meta.horizon.end_month;
  const scen = byId(meta.scenarios, r.scenario), dist = byId(meta.districts, r.district), dis = byId(meta.diseases, r.disease);
  const b = tsrText(rec.baseline, end), s = tsrText(rec.scenario, end), d = deltaText(rec);
  const who = `${dis.name.toLowerCase()} in ${dist.name}`;
  if (rec.scenario.status === "insufficient_data" || rec.baseline.status === "insufficient_data") return `Not enough reported months to say how long ${esc(who)} takes to recover.`;
  if (r.scenario === "baseline") return `With the normal climate, ${esc(who)} takes <b>${esc(b.value)} ${esc(b.unit)}</b> to recover after the outbreak peak.`;
  if (d.tone === "slower" && rec.delta_status === "lower_bound") return `Under ${esc(scen.label.toLowerCase())}, ${esc(who)} <b>never recovers before ${monthLabel(end)}</b>: at least ${esc(d.value.replace("≥ +", ""))} months longer than normal.`;
  if (d.tone === "slower") return `Under ${esc(scen.label.toLowerCase())}, recovery takes <b>${esc(d.value.replace("+", ""))} ${esc(d.unit)} longer</b> (${esc(s.value)} instead of ${esc(b.value)}).`;
  if (d.tone === "faster") return `Under ${esc(scen.label.toLowerCase())}, recovery is <b>${esc(d.value.replace("-", ""))} ${esc(d.unit)} faster</b> (${esc(s.value)} instead of ${esc(b.value)}).`;
  if (d.tone === "same") return `Under ${esc(scen.label.toLowerCase())}, recovery takes <b>the same time</b> as normal (${esc(s.value)} ${esc(s.unit)}).`;
  return `The delay can't be determined for this selection.`;
}

export async function render(view, { meta }) {
  const advanced = can("advanced");
  let range = "focus";
  let seq = 0;
  let current = null;
  let picked = null;
  let pins = [];
  const sel = getSelection();
  if (!advanced && sel.mask !== "none") setSelection({ mask: "none" });
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${screenEyebrow("simulator", advanced ? "Scenario simulator" : "Simple simulator")}</p>
        <h1>How does a climate shift change recovery?</h1>
        ${advanced ? '<p class="lede">Pick a district, a disease and one of seven climate scenarios. Each is compared with the baseline climate, from the same outbreak peak, using the same random draws.</p>' : ""}
      </div>
      <div class="row head-tools"><div id="sim-save"></div><div id="sim-pin"></div></div>
    </div>

    <section class="panel stack" aria-label="Simulation settings">
      ${selectorsHTML(meta, sel, { idPrefix: "sim", extra: advanced ? "" : scenarioSelectHTML(meta, sel, "sim") })}
      ${advanced ? `<div id="sim-scenarios">${scenarioPickerHTML(meta, sel)}</div>
      <details class="advanced"><summary>Advanced options</summary>
        <div class="controls" style="margin-top:10px">${maskSelectHTML(meta, sel, "sim")}
          <div class="field"><span class="label" id="sim-range-label">Time range</span>
            <div class="seg" role="group" aria-labelledby="sim-range-label"><button type="button" data-range="focus" aria-pressed="true">Jul 2021 – Dec 2024</button><button type="button" data-range="full" aria-pressed="false">2015 – 2024</button></div></div>
        </div>
        <p class="small" style="margin-top:8px">Reporting completeness ${infoTip("mask")} removes case months the same way the published validation runs do. Rule: ${esc(meta.recovery_rule.tsr_definition)}.</p>
      </details>` : ""}
    </section>

    <section class="answer-card" id="sim-answer" aria-live="polite">${loadingHTML("Loading recovery results…")}</section>
    ${advanced ? `<section class="demo" aria-label="Guided demo">
      <div class="stack" style="gap:4px"><span class="eyebrow" style="color:var(--ink)">Guided demo</span>
        <div class="demo-steps">${CONFIG.DEMO_SEQUENCE.map((id, k) => { const s = byId(meta.scenarios, id); return s ? `<button type="button" class="demo-step" data-scenario="${esc(id)}" aria-pressed="false"><span class="ds-n">${k + 1}</span>${esc(s.label)}</button>` : ""; }).join("")}</div>
      </div>
      <p class="demo-caption" id="demo-caption" aria-live="polite"></p>
    </section>
    <div id="sim-kpis"></div>` : ""}

    <section class="panel">
      <div class="panel-head"><h2 id="sim-chart-title">Cases: baseline vs scenario</h2><span class="small">Threshold ${infoTip("threshold")} · peak t0 ${infoTip("t0")} · waves ${infoTip("secondary_wave")}</span></div>
      <div id="sim-view">${loadingHTML()}</div>
      <div id="sim-table"></div>
    </section>

    <section class="panel" id="sim-drill" hidden aria-live="polite"></section>

    ${advanced ? `<section class="grid cols-2">
      <div class="panel"><div class="panel-head"><h2>What this scenario changes</h2></div><div id="sim-anomaly"></div></div>
      <div class="panel" id="sim-insights" hidden></div>
    </section>` : `<details class="panel learn-more"><summary><h2>How sure are we, and what do the words mean?</h2><span class="small">Details</span></summary><div id="sim-details" style="margin-top:12px"></div></details>`}
    ${can("comments.read") ? '<section class="panel" id="sim-comments"></section>' : ""}`;

  bindSelects(view);
  if (advanced) bindScenarioPicker(view);
  view.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    range = b.dataset.range;
    view.querySelectorAll("[data-range]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  }));
  view.querySelectorAll(".demo-step").forEach((b) => b.addEventListener("click", () => setSelection({ scenario: b.dataset.scenario })));
  mountSaveView(view.querySelector("#sim-save"), () => ({ screen: "simulator", ...pick(getSelection()) }), meta);
  const pinHost = view.querySelector("#sim-pin");
  const commentsHost = view.querySelector("#sim-comments");
  const comments = commentsHost ? mountComments(commentsHost, { id: "sim", view: viewKey(sel), months: focusMonths(meta), onPins: (p) => { pins = p; if (current) draw(); } }) : null;

  function pick(s) { return { district: s.district, disease: s.disease, scenario: s.scenario, mask: advanced ? s.mask : "none" }; }

  function draw() {
    if (!current) return;
    renderSimulationView(view.querySelector("#sim-view"), current, meta, {
      range, idPrefix: "sim", climate: advanced, track: true, onPick: openMonth,
      pins: pins.map((p) => ({ month: p.month, label: `${p.author}: ${p.text.slice(0, 80)}` })),
    });
    view.querySelector("#sim-table").innerHTML = dataTableHTML(current, meta, range);
  }

  function openMonth(month) {
    picked = month;
    const s = getSelection();
    const host = view.querySelector("#sim-drill");
    const dist = byId(meta.districts, s.district), dis = byId(meta.diseases, s.disease);
    const crumbs = [
      { label: "Tamil Nadu", onClick: () => { location.hash = can("analysis.read") ? "recovery" : "map"; } },
      { label: dist.name, onClick: () => { closeMonth(); view.querySelector("#sim-district")?.focus(); } },
      { label: dis.name, onClick: () => { closeMonth(); view.querySelector("#sim-chart-title")?.scrollIntoView({ block: "start" }); } },
      { label: month.slice(0, 4), onClick: () => { closeMonth(); } },
      { label: monthLabel(month) },
    ];
    host.hidden = false;
    host.innerHTML = `${crumbsHTML(crumbs)}
      <div class="panel-head"><h2>${esc(monthLabel(month))}: what was happening</h2>
        <div class="row"><label class="visually-hidden" for="sim-month">Choose another month</label>
          <select id="sim-month">${current.months.map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${esc(monthLabel(m))}</option>`).join("")}</select>
          <button type="button" class="btn btn-sm" id="sim-drill-close">Close</button></div></div>
      ${monthDetailHTML(current, month, meta)}
      ${comments && can("comments.post", { write: true }) ? '<button type="button" class="btn btn-sm" id="sim-pin-comment">📍 Comment on this month</button>' : ""}`;
    bindCrumbs(host, crumbs);
    host.querySelector("#sim-month").addEventListener("change", (e) => openMonth(e.target.value));
    host.querySelector("#sim-drill-close").addEventListener("click", closeMonth);
    host.querySelector("#sim-pin-comment")?.addEventListener("click", () => { comments.setMonth(month); commentsHost.scrollIntoView({ block: "start" }); });
    track("drilldown", { screen: "simulator", district: s.district, disease: s.disease, scenario: s.scenario });
    host.scrollIntoView({ block: "nearest" });
  }
  function closeMonth() { picked = null; const h = view.querySelector("#sim-drill"); h.hidden = true; h.innerHTML = ""; }

  async function update() {
    const my = ++seq;
    const s = getSelection();
    view.querySelectorAll('input[name="scenario"]').forEach((r) => (r.checked = r.value === s.scenario));
    view.querySelectorAll("select[data-key]").forEach((el) => (el.value = s[el.dataset.key]));
    view.querySelectorAll(".demo-step").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scenario === s.scenario)));
    const ans = view.querySelector("#sim-answer");
    ans.style.opacity = ".55";
    mountPin(pinHost, s.district, meta);
    comments?.setView(viewKey(s));
    try {
      const sim = await api.simulation(pick(s));
      if (my !== seq) return;
      current = sim;
      const scen = byId(meta.scenarios, s.scenario), dist = byId(meta.districts, s.district), dis = byId(meta.diseases, s.disease);
      const st = sim.recovery.scenario.status;
      ans.style.opacity = "1";
      ans.innerHTML = `<p class="eyebrow">The answer ${infoTip("delta_tsr")}</p><p class="answer-text">${answerText(sim, meta)}</p>
        ${st !== "recovered" ? `<p class="small">${esc(STATUS[st]?.label || st)} ${infoTip(st === "insufficient_data" ? "insufficient" : "censored")}</p>` : ""}`;
      if (advanced) {
        const kpis = view.querySelector("#sim-kpis");
        kpis.innerHTML = kpiCardsHTML(sim, meta);
        animateCounts(kpis);
        view.querySelector("#sim-anomaly").innerHTML = `<p style="margin-bottom:8px"><b>${esc(scen.label)}.</b> ${esc(scen.description)}.</p>${anomalyListHTML(sim)}<p class="small" style="margin-top:10px">Hypothetical input for a controlled experiment, not a climate projection for Tamil Nadu. <a href="#report">Open the scenario report</a>.</p>`;
        view.querySelector("#demo-caption").innerHTML = demoCaption(sim, meta, dist, dis, scen);
        mountInsights(view.querySelector("#sim-insights"), s);
      } else {
        const u = sim.recovery.scenario.uncertainty || {};
        view.querySelector("#sim-details").innerHTML = `<ul class="plain small">
          <li><b>How sure?</b> ${infoTip("spread")} ${u.p10_months != null ? `Across ${u.replicates} noisy copies of the data, recovery takes ${Math.round(u.p10_months)}–${Math.round(u.p90_months)} months for 8 in 10 copies.` : "The spread is not available for this selection."}</li>
          <li><b>Outbreak peak:</b> ${monthLabel(sim.reference.t0_month)} ${infoTip("t0")}. Recovery is counted from here for every climate.</li>
          <li><b>Recovered</b> means ${esc(meta.recovery_rule.window_months)} months in a row at or below the usual level ${infoTip("threshold")}.</li>
          <li><b>${plural(sim.recovery.scenario.interruption_count, "interruption")}</b> ${infoTip("interruption")} before recovery.</li>
          <li>${esc(scen.description)}. A pretend change for a controlled experiment, not a projection.</li></ul>`;
      }
      view.querySelector("#sim-chart-title").textContent = s.scenario === "baseline" ? `${dis.name} cases in ${dist.name}: baseline climate` : `${dis.name} cases in ${dist.name}: baseline vs ${scen.label.toLowerCase()}`;
      draw();
      if (picked) openMonth(picked);
      track("simulation_view", { screen: "simulator", district: s.district, disease: s.disease, scenario: s.scenario });
    } catch (err) {
      if (my !== seq) return;
      ans.style.opacity = "1";
      ans.innerHTML = errorHTML(err, "sim-retry");
      ans.querySelector("#sim-retry")?.addEventListener("click", update);
    }
  }

  const off = onSelection(update);
  await update();
  return off;
}

function focusMonths(meta) {
  const out = [];
  let [y, m] = CONFIG.FOCUS_RANGE.start.split("-").map(Number);
  const end = meta.horizon.end_month;
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    out.push(ym);
    if (ym >= end) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function demoCaption(sim, meta, dist, dis, scen) {
  const rec = sim.recovery;
  const end = meta.horizon.end_month;
  const b = tsrText(rec.baseline, end);
  if (sim.request.scenario === "baseline") {
    return `<b>Step 1, baseline climate.</b> ${esc(dis.name)} in ${esc(dist.name)} peaks in ${monthLabel(sim.reference.t0_month)} and reaches sustained recovery after <b>${esc(b.value)} ${esc(b.unit)}</b>. Next, switch to a climate scenario.`;
  }
  const s = tsrText(rec.scenario, end);
  const d = deltaText(rec);
  const n = rec.scenario.interruption_count;
  const idx = CONFIG.DEMO_SEQUENCE.indexOf(sim.request.scenario);
  const stepTxt = idx >= 0 ? `Step ${idx + 1}, ${esc(scen.label.toLowerCase())}.` : `${esc(scen.label)}.`;
  const main = d.tone === "same" ? `Recovery still takes <b>${esc(s.value)} ${esc(s.unit)}</b>, the same as the baseline climate.`
    : d.tone === "faster" ? `Recovery takes <b>${esc(s.value)} ${esc(s.unit)}</b> instead of ${esc(b.value)}: <b>${esc(d.value.replace("-", "−"))} ${esc(d.unit)}</b>, faster than baseline.`
    : `Recovery takes <b>${esc(s.value)} ${esc(s.unit)}</b> instead of ${esc(b.value)}: a delay of <b>${esc(d.value)} ${esc(d.unit)}</b>.`;
  return `<b>${stepTxt}</b> ${main} ${n ? `${plural(n, "secondary wave")} ${n === 1 ? "interrupts" : "interrupt"} recovery.` : "No secondary wave interrupts recovery."}`;
}
