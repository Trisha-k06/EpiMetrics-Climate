// Screen 2: main climate scenario simulator.
import { CONFIG } from "../config.js";
import { api } from "../api.js";
import { getSelection, setSelection, onSelection } from "../state.js";
import { esc, monthLabel, byId, tsrText, deltaText, plural } from "../format.js";
import { selectorsHTML, bindSelects, scenarioPickerHTML, bindScenarioPicker, kpiCardsHTML, renderSimulationView, dataTableHTML, anomalyListHTML, loadingHTML, errorHTML, animateCounts } from "../ui.js";

export async function render(view, { meta }) {
  let range = "focus";
  let seq = 0;
  const sel = getSelection();
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Screen 2 · Scenario simulator</p>
        <h1>How does a climate shift change recovery?</h1>
        <p class="lede">Pick a district, a disease and one of seven climate scenarios. The scenario is compared with the baseline climate, from the same reference outbreak peak, using the same random draws.</p>
      </div>
      <a class="btn" href="#report">Open scenario report</a>
    </div>

    <section class="panel stack" aria-label="Simulation settings">
      <div class="row" style="justify-content:space-between;align-items:flex-end">${selectorsHTML(meta, sel, { idPrefix: "sim" })}
        <p class="small" style="max-width:46ch">Recovery rule: ${esc(meta.recovery_rule.tsr_definition)}.</p>
      </div>
      <div id="sim-scenarios">${scenarioPickerHTML(meta, sel)}</div>
      <p class="small" id="sim-custom-note">Custom rain and temperature sliders arrive with the live backend (<span class="mono">POST /simulate</span>).</p>
    </section>

    <section class="demo" aria-label="Guided demo">
      <div class="stack" style="gap:4px"><span class="eyebrow" style="color:var(--ink)">Guided demo</span>
        <div class="demo-steps" id="demo-steps">${CONFIG.DEMO_SEQUENCE.map((id, k) => {
          const s = byId(meta.scenarios, id);
          return s ? `<button type="button" class="demo-step" data-scenario="${esc(id)}" aria-pressed="false"><span class="ds-n">${k + 1}</span>${esc(s.label)}</button>` : "";
        }).join("")}</div>
      </div>
      <p class="demo-caption" id="demo-caption" aria-live="polite"></p>
    </section>

    <div id="sim-kpis">${loadingHTML("Loading recovery results…")}</div>

    <section class="panel">
      <div class="panel-head">
        <h2 id="sim-chart-title">Cases: baseline vs scenario</h2>
        <div class="seg" role="group" aria-label="Time range">
          <button type="button" data-range="focus" aria-pressed="true">Jul 2021 – Dec 2024</button>
          <button type="button" data-range="full" aria-pressed="false">Full 2015 – 2024</button>
        </div>
      </div>
      <div id="sim-view">${loadingHTML()}</div>
      <div id="sim-table"></div>
    </section>

    <section class="grid cols-2">
      <div class="panel"><div class="panel-head"><h2>What this scenario changes</h2></div><div id="sim-anomaly"></div></div>
      <div class="panel"><div class="panel-head"><h2>How to read the result</h2></div>
        <ul class="plain small">
          <li><b>t0</b> is the outbreak peak in the baseline series. Every scenario measures recovery from the same t0.</li>
          <li><b>Sustained recovery</b> starts in the first month of ${meta.recovery_rule.window_months} consecutive months at or below the endemic threshold.</li>
          <li><b>ΔTSR</b> is the extra time to recover compared with the baseline climate. A censored series shows "≥", because recovery never happened before ${monthLabel(meta.horizon.end_month)}.</li>
          <li><b>Secondary waves</b> that start before sustained recovery are interruptions. They are the main way a climate shift delays recovery.</li>
        </ul>
      </div>
    </section>`;

  bindSelects(view);
  bindScenarioPicker(view);
  view.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    range = b.dataset.range;
    view.querySelectorAll("[data-range]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    update();
  }));
  view.querySelectorAll(".demo-step").forEach((b) => b.addEventListener("click", () => setSelection({ scenario: b.dataset.scenario })));

  async function update() {
    const my = ++seq;
    const s = getSelection();
    view.querySelectorAll('input[name="scenario"]').forEach((r) => (r.checked = r.value === s.scenario));
    view.querySelectorAll("select[data-key]").forEach((el) => (el.value = s[el.dataset.key]));
    view.querySelectorAll(".demo-step").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scenario === s.scenario)));
    const kpis = view.querySelector("#sim-kpis");
    kpis.style.opacity = ".55";
    try {
      const sim = await api.simulation(s);
      if (my !== seq) return;
      const scen = byId(meta.scenarios, s.scenario);
      const dist = byId(meta.districts, s.district);
      const dis = byId(meta.diseases, s.disease);
      kpis.innerHTML = kpiCardsHTML(sim, meta);
      animateCounts(kpis);
      kpis.style.opacity = "1";
      view.querySelector("#sim-chart-title").textContent = s.scenario === "baseline" ? `${dis.name} cases in ${dist.name}: baseline climate` : `${dis.name} cases in ${dist.name}: baseline vs ${scen.label.toLowerCase()}`;
      renderSimulationView(view.querySelector("#sim-view"), sim, meta, { range, idPrefix: "sim" });
      view.querySelector("#sim-table").innerHTML = dataTableHTML(sim, meta, range);
      view.querySelector("#sim-anomaly").innerHTML = `<p style="margin-bottom:8px"><b>${esc(scen.label)}.</b> ${esc(scen.description)}.</p>${anomalyListHTML(sim)}<p class="small" style="margin-top:10px">Hypothetical input for a controlled experiment, not a climate projection for Tamil Nadu.</p>`;
      view.querySelector("#demo-caption").innerHTML = demoCaption(sim, meta, dist, dis, scen);
    } catch (err) {
      if (my !== seq) return;
      kpis.style.opacity = "1";
      kpis.innerHTML = errorHTML(err, "sim-retry");
      kpis.querySelector("#sim-retry")?.addEventListener("click", update);
    }
  }

  const off = onSelection(update);
  await update();
  return off;
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
