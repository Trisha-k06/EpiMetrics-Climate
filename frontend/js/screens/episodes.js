// Screen 4: outbreak episodes across the whole 2015–2024 series (notebooks 06–07). Every number comes from
// GET /analytics/episodes; this screen only arranges it.
import { api } from "../api.js";
import { getSelection, setSelection, onSelection } from "../state.js";
import { esc, monthLabel, byId, fmtInt, fmtNum, fmtSigned } from "../format.js";
import { barChart, seriesLegendHTML } from "../charts.js";
import { loadingHTML, errorHTML, DISEASE_COLORS, passPill, screenEyebrow } from "../ui.js";
import { infoTip } from "../components/tooltip.js";

const BARS = [
  { key: "mean_recovery_months", title: "Mean recovery time", unit: "months", fmt: (v) => fmtNum(v, 1), note: "Recovered episodes only" },
  { key: "interrupted_pct", title: "Episodes with an interruption", unit: "%", fmt: (v) => fmtNum(v, 1), note: "Share of episodes with at least one renewed month above threshold" },
  { key: "unresolved_pct", title: "Unresolved episodes", unit: "%", fmt: (v) => fmtNum(v, 1), note: "Still above threshold or not yet 3 months below it in Dec 2024" },
];

export async function render(view, { meta }) {
  let seq = 0;
  const sel = getSelection();
  const scenLabel = (id) => byId(meta.scenarios, id)?.label || id;
  const distName = (id) => byId(meta.districts, id)?.name || id;
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${screenEyebrow("episodes", "Outbreak episodes")}</p>
        <h1>How long do outbreaks take to recover, across the whole decade? ${infoTip("episode")}</h1>
        <p class="lede">Every month above the endemic threshold starts an outbreak episode; it recovers once cases stay at or below the threshold for 3 months in a row. This repeats the analysis of notebooks 06 and 07 for all districts, diseases and scenarios.</p>
      </div>
    </div>
    <section class="callout callout-accent" role="note"><b>A different lens from the simulator.</b> The simulator measures one recovery (TSR) from one reference peak. Here every outbreak from 2015 to 2024 counts, and recovery time runs from the episode's first month above the threshold. Both use the same synthetic data.</section>
    <div id="ep-kpis">${loadingHTML("Loading episode analysis…")}</div>
    <section class="panel">
      <div class="panel-head"><h2>By climate scenario</h2><span class="small">Dengue and malaria, all five districts</span></div>
      ${seriesLegendHTML(meta.diseases.map((d) => ({ label: d.name, color: DISEASE_COLORS[d.id] })))}
      <div class="grid cols-3" id="ep-bars"></div>
      <details class="data-table" style="margin-top:10px"><summary>Show the table behind these charts</summary><div id="ep-bars-table" style="margin-top:8px"></div></details>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Matched recovery delay (ΔTSR) ${infoTip("matched_delta")}</h2><span class="small">Scenario episode minus the baseline episode that starts in the same month; both must recover</span></div>
      <div id="ep-matched"></div>
    </section>
    <section class="panel stack">
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <div class="row" style="align-items:flex-end">
          <div class="field"><label for="ep-disease">Disease</label><select id="ep-disease">${meta.diseases.map((d) => `<option value="${esc(d.id)}" ${d.id === sel.disease ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="ep-district">District</label><select id="ep-district">${meta.districts.map((d) => `<option value="${esc(d.id)}" ${d.id === sel.district ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
        </div>
      </div>
      <div><h2 class="h3" id="ep-tl-title">Episode timeline</h2><div id="ep-timeline"></div></div>
      <div><h2 class="h3">District comparison with the baseline</h2><div id="ep-districts"></div></div>
    </section>
    <section class="grid cols-2">
      <div class="panel"><div class="panel-head"><h2>Sensitivity to the recovery rule</h2><span class="small">Baseline scenario, 2, 3 or 4 calm months</span></div><div id="ep-sens"></div></div>
      <div class="panel"><div class="panel-head"><h2>Recovery-engine unit tests</h2><span class="small">Notebook 06, run live on the server</span></div><div id="ep-tests"></div></div>
    </section>`;

  const dSel = view.querySelector("#ep-disease"), districtSel = view.querySelector("#ep-district");
  dSel.addEventListener("change", () => setSelection({ disease: dSel.value }));
  districtSel.addEventListener("change", () => setSelection({ district: districtSel.value }));

  let drawnGlobal = false;
  async function update() {
    const my = ++seq;
    const s = getSelection();
    dSel.value = s.disease;
    districtSel.value = s.district;
    let data;
    try {
      data = await api.episodes({ disease: s.disease });
    } catch (err) {
      if (my === seq) view.querySelector("#ep-kpis").innerHTML = errorHTML(err);
      return;
    }
    if (my !== seq) return;
    if (!drawnGlobal) { drawGlobal(data); drawnGlobal = true; }
    drawDisease(data, s);
  }

  function drawGlobal(d) {
    const t = d.totals, m = d.matched;
    view.querySelector("#ep-kpis").innerHTML = `<div class="kpis">
      <article class="kpi kpi-primary"><div class="kpi-label">Outbreak episodes</div><div class="kpi-value">${fmtInt(t.episodes)}</div><div class="kpi-compare"><span>${fmtInt(t.recovered)} recovered · ${fmtInt(t.unresolved)} unresolved by ${monthLabel(meta.horizon.end_month)}</span><span class="muted">70 series: 5 districts × 2 diseases × 7 scenarios</span></div></article>
      <article class="kpi"><div class="kpi-label">Recovery interruptions</div><div class="kpi-value">${fmtInt(t.interruptions)}</div><div class="kpi-compare"><span>Months back above threshold after at least one calm month</span></div></article>
      <article class="kpi"><div class="kpi-label">Matched episodes</div><div class="kpi-value">${fmtInt(m.matched_episodes)}<span class="unit">of ${fmtInt(m.climate_episodes)}</span></div><div class="kpi-compare"><span>${fmtNum(m.matching_coverage_pct, 2)}% of climate-scenario episodes start in the same month as a baseline episode</span></div></article>
      <article class="kpi"><div class="kpi-label">Mean matched ΔTSR</div><div class="kpi-value">${fmtSigned(m.mean_delta_tsr_months, 2)}<span class="unit">months</span></div><div class="kpi-compare"><span>Over ${fmtInt(m.valid_delta_tsr_pairs)} pairs where both episodes recovered</span></div></article>
    </div>`;

    const host = view.querySelector("#ep-bars");
    host.innerHTML = BARS.map((b) => `<div><div class="small" style="font-weight:600;color:var(--ink)">${esc(b.title)} (${esc(b.unit)})</div><div class="small">${esc(b.note)}</div><div id="ep-bar-${b.key}"></div></div>`).join("");
    const scen = [...new Set(d.by_scenario.map((r) => r.scenario))];
    const get = (sc, dz, k) => d.by_scenario.find((r) => r.scenario === sc && r.disease === dz)?.[k] ?? null;
    for (const b of BARS) {
      barChart(host.querySelector(`#ep-bar-${b.key}`), {
        categories: scen.map(scenLabel), unit: b.unit, unitShort: b.unit === "%" ? "%" : "mo", valueFmt: b.fmt, height: 220,
        series: meta.diseases.map((dz) => ({ label: dz.name, color: DISEASE_COLORS[dz.id], values: scen.map((sc) => get(sc, dz.id, b.key)) })),
        ariaLabel: `${b.title} by climate scenario for dengue and malaria`,
      });
    }
    view.querySelector("#ep-bars-table").innerHTML = `<div class="table-wrap scroll-y"><table><thead><tr><th>Scenario</th><th>Disease</th><th class="n">Episodes</th><th class="n">Recovered</th><th class="n">Mean recovery (mo)</th><th class="n">Interrupted %</th><th class="n">Unresolved %</th><th class="n">Interruptions</th></tr></thead><tbody>
      ${d.by_scenario.map((r) => `<tr><td>${esc(scenLabel(r.scenario))}</td><td>${esc(byId(meta.diseases, r.disease)?.name)}</td><td class="n">${r.episodes}</td><td class="n">${r.recovered}</td><td class="n">${fmtNum(r.mean_recovery_months, 2)}</td><td class="n">${fmtNum(r.interrupted_pct, 1)}</td><td class="n">${fmtNum(r.unresolved_pct, 1)}</td><td class="n">${r.total_interruptions}</td></tr>`).join("")}</tbody></table></div>`;

    view.querySelector("#ep-matched").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Scenario</th>${meta.diseases.map((dz) => `<th class="n">${esc(dz.name)}: pairs</th><th class="n">mean ΔTSR</th><th class="n">median</th><th class="n">Δ interruptions</th>`).join("")}</tr></thead><tbody>
      ${[...new Set(d.matched_summary.map((r) => r.scenario))].map((sc) => `<tr><td>${esc(scenLabel(sc))}</td>${meta.diseases.map((dz) => {
        const r = d.matched_summary.find((x) => x.scenario === sc && x.disease === dz.id) || {};
        return `<td class="n">${fmtInt(r.comparable_recovered)} / ${fmtInt(r.matched_episodes)}</td><td class="n">${fmtSigned(r.mean_delta_tsr, 2)}</td><td class="n">${fmtSigned(r.median_delta_tsr, 1)}</td><td class="n">${fmtSigned(r.mean_delta_interruptions, 2)}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="small" style="margin-top:8px">Pairs: matched episodes where both recovered / all matched episodes. Positive ΔTSR means the scenario's episode took longer to recover. Most medians are 0: the climate change only alters the few episodes it touches.</p>`;

    const sens = d.sensitivity;
    view.querySelector("#ep-sens").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Disease</th><th class="n">Calm months</th><th class="n">Episodes</th><th class="n">Recovered</th><th class="n">Unresolved</th><th class="n">Mean (mo)</th><th class="n">Median (mo)</th><th class="n">Interruptions</th></tr></thead><tbody>
      ${sens.map((r) => `<tr ${r.is_default ? 'class="row-default"' : ""}><td>${esc(byId(meta.diseases, r.disease)?.name)}</td><td class="n">${r.sustained_months}${r.is_default ? " ★" : ""}</td><td class="n">${r.total_episodes}</td><td class="n">${r.recovered_episodes}</td><td class="n">${r.unresolved_episodes}</td><td class="n">${fmtNum(r.mean_recovery_months, 2)}</td><td class="n">${fmtNum(r.median_recovery_months, 1)}</td><td class="n">${r.total_interruptions}</td></tr>`).join("")}</tbody></table></div>
      <p class="small" style="margin-top:8px">★ the default rule. A stricter rule (more calm months) merges short episodes and lengthens recovery, which is why the rule must be stated with every result.</p>`;

    view.querySelector("#ep-tests").innerHTML = `<ul class="check-list">${d.unit_tests.map((u) => `<li>${passPill(u.pass)}<div><b>${esc(u.name)}</b><div class="small">Months: ${u.input.map((x) => (x === "above" ? "▲" : "▽")).join(" ")} → ${esc(u.detail)}</div></div></li>`).join("")}</ul>
      <p class="small" style="margin-top:8px">▲ above threshold, ▽ at or below. The same function produces every episode on this screen.</p>`;
  }

  function drawDisease(d, s) {
    const dis = byId(meta.diseases, s.disease);
    view.querySelector("#ep-tl-title").textContent = `Episode timeline · ${dis?.name} in ${distName(s.district)}`;
    const months = d.months, N = months.length, pos = (m) => (months.indexOf(m) / N) * 100;
    const eps = d.timeline.filter((e) => e.district === s.district);
    const scen = meta.scenarios.map((x) => x.id);
    const years = months.filter((m) => m.endsWith("-01"));
    view.querySelector("#ep-timeline").innerHTML = `<div class="gantt" role="img" aria-label="Outbreak episodes from ${monthLabel(months[0])} to ${monthLabel(months[N - 1])} for each climate scenario">
      <div class="g-axis"><span class="g-label"></span><div class="g-track">${years.map((y) => `<span class="g-year" style="left:${pos(y)}%">${y.slice(0, 4)}</span>`).join("")}</div></div>
      ${scen.map((sc) => `<div class="g-row"><span class="g-label">${esc(scenLabel(sc))}</span><div class="g-track">${years.map((y) => `<span class="g-grid" style="left:${pos(y)}%"></span>`).join("")}${eps.filter((e) => e.scenario === sc).map((e) => {
        const a = pos(e.onset), b = e.recovery ? ((months.indexOf(e.recovery) + 1) / N) * 100 : 100;
        const tip = `${scenLabel(sc)}: onset ${monthLabel(e.onset)}, ${e.status === "recovered" ? `recovered ${monthLabel(e.recovery)} after ${e.recovery_months} months` : "unresolved at the end of the data"}, ${e.interruptions} interruption${e.interruptions === 1 ? "" : "s"}`;
        return `<span class="g-bar ${e.status === "recovered" ? "" : "g-open"}" style="left:${a}%;width:${Math.max(b - a, 0.6)}%;background:${DISEASE_COLORS[s.disease]}" title="${esc(tip)}">${e.interruptions ? `<i>${e.interruptions}</i>` : ""}</span>`;
      }).join("")}</div></div>`).join("")}
    </div>
    <p class="small" style="margin-top:6px">Each bar runs from the first month above the threshold to the end of the 3 calm months. Numbers inside bars count interruptions; hatched bars never recovered by ${monthLabel(meta.horizon.end_month)}. Hover a bar for details.</p>`;

    const rows = d.districts.filter((r) => r.district === s.district);
    const all = d.districts;
    const diff = (v, nd = 2) => (v == null ? "—" : `<span class="${v > 0 ? "t-worse" : v < 0 ? "t-better" : ""}">${fmtSigned(v, nd)}</span>`);
    const tableRows = (list) => list.map((r) => `<tr ${r.district === s.district ? 'class="row-default"' : ""}><td>${esc(distName(r.district))}</td><td>${esc(scenLabel(r.scenario))}</td><td class="n">${r.episodes}</td><td class="n">${r.recovered}</td><td class="n">${r.unresolved}</td><td class="n">${fmtNum(r.mean_recovery_months, 2)}</td><td class="n">${diff(r.mean_recovery_difference_months)}</td><td class="n">${r.total_interruptions}</td><td class="n">${diff(r.interruption_difference, 0)}</td></tr>`).join("");
    const head = `<thead><tr><th>District</th><th>Scenario</th><th class="n">Episodes</th><th class="n">Recovered</th><th class="n">Unresolved</th><th class="n">Mean recovery (mo)</th><th class="n">vs baseline</th><th class="n">Interruptions</th><th class="n">vs baseline</th></tr></thead>`;
    view.querySelector("#ep-districts").innerHTML = `<div class="table-wrap"><table>${head}<tbody>${tableRows(rows)}</tbody></table></div>
      <details class="data-table" style="margin-top:8px"><summary>All districts for ${esc(dis?.name)}</summary><div class="table-wrap scroll-y" style="margin-top:8px"><table>${head}<tbody>${tableRows(all)}</tbody></table></div></details>`;
  }

  const off = onSelection(update);
  await update();
  return off;
}
