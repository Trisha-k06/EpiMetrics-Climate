// What-if comparison: scenario A vs scenario B for one district and disease (everyone), or the same scenario in two
// districts (analysts). Two /simulations calls; the only arithmetic here is the displayed difference of the two API TSR
// values, labelled as such.
import { api, track } from "../api.js";
import { can } from "../auth.js";
import { getSelection, setSelection, onSelection } from "../state.js";
import { esc, byId, monthLabel, tsrText, deltaText, statusPill, fmtInt, rangeIdx } from "../format.js";
import { timeChart, recoveryTrack, seriesLegendHTML } from "../charts.js";
import { selectorsHTML, maskSelectHTML, bindSelects, errorHTML, loadingHTML, screenEyebrow, COLORS } from "../ui.js";
import { CONFIG } from "../config.js";
import { infoTip } from "../components/tooltip.js";
import { mountComments, viewKey } from "../components/comments.js";
import { mountSaveView } from "../components/saved.js";

const A_COLOR = "var(--c2)", B_COLOR = "var(--c3)";

export async function render(view, { meta }) {
  const advanced = can("advanced");
  let seq = 0;
  const sel = getSelection();
  const optList = (list, cur, label) => list.map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? "selected" : ""}>${esc(label(x))}</option>`).join("");
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${screenEyebrow("compare", "Compare climates")}</p>
        <h1>Which climate makes recovery take longer?</h1>
        <p class="lede">Put two climate scenarios side by side for the same district and disease${advanced ? ", or the same scenario in two districts" : ""}.</p>
      </div>
      <div id="cmp-save"></div>
    </div>
    <section class="panel stack" aria-label="Comparison settings">
      ${selectorsHTML(meta, sel, { idPrefix: "cmp" })}
      <div class="controls">
        <div class="field"><label for="cmp-a"><span class="swatch" style="background:${A_COLOR}"></span> Scenario A</label><select id="cmp-a" data-key="scenario">${optList(meta.scenarios, sel.scenario, (s) => s.label)}</select></div>
        <div class="field" id="cmp-b-field"><label for="cmp-b"><span class="swatch" style="background:${B_COLOR}"></span> Scenario B</label><select id="cmp-b" data-key="compareB">${optList(meta.scenarios, sel.compareB, (s) => s.label)}</select></div>
      </div>
      ${advanced ? `<details class="advanced" ${sel.compareDistrict ? "open" : ""}><summary>Advanced options</summary>
        <div class="controls" style="margin-top:10px">
          <div class="field"><label for="cmp-d2">Compare across districts</label><select id="cmp-d2"><option value="">Off: compare two scenarios</option>${optList(meta.districts.filter((d) => d.id !== sel.district), sel.compareDistrict, (d) => `Scenario A in ${d.name}`)}</select></div>
          ${maskSelectHTML(meta, sel, "cmp")}
        </div></details>` : ""}
    </section>
    <section class="answer-card" id="cmp-answer" aria-live="polite">${loadingHTML("Comparing…")}</section>
    <section class="grid cols-2" id="cmp-cols"></section>
    <section class="panel"><div class="panel-head"><h2 id="cmp-chart-title">Cases over time</h2><span class="small">Threshold ${infoTip("threshold")}</span></div>
      <div id="cmp-legend"></div><div id="cmp-chart"></div>
      <div class="small" style="margin:10px 0 2px">Recovery timelines, aligned on the same months</div><div id="cmp-tracks"></div>
      <details class="data-table"><summary>Show the data behind this chart</summary><div id="cmp-table" style="margin-top:8px"></div></details>
    </section>
    ${can("comments.read") ? '<section class="panel" id="cmp-comments"></section>' : ""}`;
  bindSelects(view);
  const d2 = view.querySelector("#cmp-d2");
  d2?.addEventListener("change", () => setSelection({ compareDistrict: d2.value || null }));
  const comments = view.querySelector("#cmp-comments") ? mountComments(view.querySelector("#cmp-comments"), { id: "cmp", view: viewKey(sel), months: [] }) : null;
  mountSaveView(view.querySelector("#cmp-save"), () => {
    const s = getSelection();
    return { screen: "compare", district: s.district, disease: s.disease, scenario: s.scenario, mask: advanced ? s.mask : "none",
      scenario_b: s.compareDistrict ? null : s.compareB, district_b: advanced ? s.compareDistrict : null };
  }, meta);

  async function update() {
    const my = ++seq;
    const s = getSelection();
    const cross = advanced && s.compareDistrict && s.compareDistrict !== s.district;
    view.querySelectorAll("select[data-key]").forEach((el) => (el.value = s[el.dataset.key]));
    if (d2) {
      d2.innerHTML = `<option value="">Off: compare two scenarios</option>${optList(meta.districts.filter((d) => d.id !== s.district), cross ? s.compareDistrict : "", (d) => `Scenario A in ${d.name}`)}`;
      d2.value = cross ? s.compareDistrict : "";
    }
    view.querySelector("#cmp-b-field").hidden = !!cross;
    const mask = advanced ? s.mask : "none";
    const reqA = { district: s.district, disease: s.disease, scenario: s.scenario, mask };
    const reqB = cross ? { ...reqA, district: s.compareDistrict } : { ...reqA, scenario: s.compareB };
    comments?.setView(viewKey(s));
    view.querySelector("#cmp-answer").style.opacity = ".55";
    let A, B;
    try {
      [A, B] = await Promise.all([api.simulation(reqA), api.simulation(reqB)]);
    } catch (err) {
      if (my !== seq) return;
      view.querySelector("#cmp-answer").style.opacity = "1";
      view.querySelector("#cmp-answer").innerHTML = errorHTML(err);
      return;
    }
    if (my !== seq) return; // a newer selection is already loading
    track("compare", { screen: "compare", district: s.district, disease: s.disease, scenario: s.scenario });
    const end = meta.horizon.end_month;
    const name = (r) => (cross ? byId(meta.districts, r.request.district).name : byId(meta.scenarios, r.request.scenario).label);
    const tA = A.recovery.scenario, tB = B.recovery.scenario;
    const ans = view.querySelector("#cmp-answer");
    ans.style.opacity = "1";
    let text;
    if (tA.status === "recovered" && tB.status === "recovered") {
      const diff = tB.tsr_months - tA.tsr_months; // difference of the two API values, for display
      text = diff === 0 ? `<b>${esc(name(B))}</b> and <b>${esc(name(A))}</b> recover in the same time: ${tA.tsr_months} months.`
        : `<b>${esc(name(B))}</b> recovers <b>${Math.abs(diff)} ${Math.abs(diff) === 1 ? "month" : "months"} ${diff > 0 ? "later" : "sooner"}</b> than <b>${esc(name(A))}</b> (${tB.tsr_months} vs ${tA.tsr_months} months).`;
    } else {
      const say = (r, t) => (t.status === "recovered" ? `${esc(name(r))} recovers in ${t.tsr_months} months` : t.status === "not_recovered_within_horizon" ? `${esc(name(r))} does not recover before ${monthLabel(end)}` : `${esc(name(r))} has too little data to tell`);
      text = `${say(A, tA)}; ${say(B, tB)}.`;
    }
    ans.innerHTML = `<p class="eyebrow">The difference ${infoTip("tsr")}</p><p class="answer-text">${text}</p>
      <p class="small">Difference of the two API values for time to sustained recovery, ${esc(byId(meta.diseases, s.disease).name.toLowerCase())}${cross ? "" : ` in ${esc(byId(meta.districts, s.district).name)}`}. Not a forecast.</p>`;

    const col = (r, color, label) => {
      const t = tsrText(r.recovery.scenario, end), d = deltaText(r.recovery);
      return `<article class="panel cmp-col" style="border-top:4px solid ${color}">
        <h2>${esc(label)}</h2><p class="small">${esc(byId(meta.districts, r.request.district).name)} · ${esc(byId(meta.scenarios, r.request.scenario).label)}</p>
        <dl class="dl kpi-dl">
          <dt>Time to recover ${infoTip("tsr")}</dt><dd><b class="num">${esc(t.value)}</b> ${esc(t.unit)}</dd>
          <dt>vs baseline ${infoTip("delta_tsr")}</dt><dd><b class="num">${r.request.scenario === "baseline" ? "reference" : esc(`${d.value} ${d.unit}`)}</b></dd>
          <dt>Interruptions ${infoTip("interruption")}</dt><dd><b class="num">${fmtInt(r.recovery.scenario.interruption_count)}</b></dd>
          <dt>Status</dt><dd>${statusPill(r.recovery.scenario.status)}</dd>
        </dl></article>`;
    };
    view.querySelector("#cmp-cols").innerHTML = col(A, A_COLOR, `A · ${name(A)}`) + col(B, B_COLOR, `B · ${name(B)}`);

    const months = A.months;
    const R = rangeIdx(months, CONFIG.FOCUS_RANGE.start, CONFIG.FOCUS_RANGE.end);
    const series = cross
      ? [{ label: `${name(A)} baseline`, values: A.series.baseline.observed_cases, color: COLORS.baseline, dash: "5 4" },
        { label: `A · ${name(A)}`, values: A.series.scenario.observed_cases, color: A_COLOR },
        { label: `B · ${name(B)}`, values: B.series.scenario.observed_cases, color: B_COLOR }]
      : [{ label: "Baseline", values: A.series.baseline.observed_cases, color: COLORS.baseline },
        { label: `A · ${name(A)}`, values: A.series.scenario.observed_cases, color: A_COLOR },
        { label: `B · ${name(B)}`, values: B.series.scenario.observed_cases, color: B_COLOR }];
    view.querySelector("#cmp-chart-title").textContent = cross ? `${byId(meta.scenarios, s.scenario).label}: ${name(A)} vs ${name(B)}` : `${byId(meta.diseases, s.disease).name} in ${byId(meta.districts, s.district).name}`;
    view.querySelector("#cmp-legend").innerHTML = seriesLegendHTML(series, '<span><span class="swatch swatch-line"></span>Threshold (A)</span>');
    timeChart(view.querySelector("#cmp-chart"), { months, range: R, unit: cross ? "Cases / month (different populations)" : "Cases / month", series,
      steps: { label: "Threshold (A)", values: A.threshold_cases, color: COLORS.threshold },
      vlines: [{ month: A.reference.t0_month, label: "t0 peak", color: "var(--ink-2)", dash: "4 3", top: true }],
      ariaLabel: `Monthly cases: baseline, scenario A and scenario B` });
    const tracksHost = view.querySelector("#cmp-tracks");
    tracksHost.innerHTML = cross ? '<div class="cmp-track-a"></div><div class="cmp-track-b"></div>' : '<div class="cmp-track-a"></div>';
    if (cross) {
      recoveryTrack(tracksHost.querySelector(".cmp-track-a"), { months, range: R, t0: A.reference.t0_month, horizonEnd: end,
        rows: [{ label: `A · ${name(A)}`, color: A_COLOR, block: tA, waves: A.waves.scenario }], ariaLabel: "Recovery timeline A" });
      recoveryTrack(tracksHost.querySelector(".cmp-track-b"), { months, range: R, t0: B.reference.t0_month, horizonEnd: end,
        rows: [{ label: `B · ${name(B)}`, color: B_COLOR, block: tB, waves: B.waves.scenario }], ariaLabel: "Recovery timeline B" });
    } else {
      recoveryTrack(tracksHost.querySelector(".cmp-track-a"), { months, range: R, t0: A.reference.t0_month, horizonEnd: end,
        rows: [{ label: "Baseline", color: COLORS.baseline, block: A.recovery.baseline, waves: A.waves.baseline },
          { label: `A · ${name(A)}`, color: A_COLOR, block: tA, waves: A.waves.scenario },
          { label: `B · ${name(B)}`, color: B_COLOR, block: tB, waves: B.waves.scenario }],
        ariaLabel: "Recovery timelines for the baseline, scenario A and scenario B, aligned on the same months" });
    }
    let rows = "";
    for (let i = R[0]; i <= R[1]; i++) rows += `<tr><td>${monthLabel(months[i])}</td>${series.map((x) => `<td class="n">${fmtInt(x.values[i])}</td>`).join("")}<td class="n">${fmtInt(Math.round(A.threshold_cases[i]))}</td></tr>`;
    view.querySelector("#cmp-table").innerHTML = `<div class="table-wrap scroll-y"><table><thead><tr><th>Month</th>${series.map((x) => `<th class="n">${esc(x.label)}</th>`).join("")}<th class="n">Threshold (A)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  const off = onSelection(update);
  await update();
  return off;
}
