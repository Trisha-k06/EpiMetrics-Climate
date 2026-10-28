// Screen 6: forecast benchmarks (notebooks 03–05). Errors, predictions and feature importance all come from
// GET /analytics/forecasts and /analytics/forecast-summary; the browser computes no model metric.
import { api } from "../api.js";
import { getSelection, onSelection } from "../state.js";
import { esc, byId, fmtNum, fmtSigned } from "../format.js";
import { timeChart, barChart, seriesLegendHTML } from "../charts.js";
import { selectorsHTML, bindSelects, loadingHTML, errorHTML, CAT, passPill, screenEyebrow } from "../ui.js";
import { infoTip } from "../components/tooltip.js";

export async function render(view, { meta }) {
  let seq = 0;
  const shown = new Set(["seasonal_naive", "random_forest", "sarimax"]);
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${screenEyebrow("models", "Forecast models")}</p>
        <h1>How well can case counts be forecast?</h1>
        <p class="lede">Six forecasting models from notebooks 03–05, trained on 2015–2021 and tested on 2022–2024 of the baseline series: seasonal naive, a climate-aware random forest, ARIMA, SARIMA, SARIMAX with climate, and lagged SARIMAX.</p>
      </div>
    </div>
    <section class="callout callout-warn" role="note"><b>These are benchmarks, not the project's outcome.</b> The simulator measures recovery time (TSR and ΔTSR), not next month's cases. The forecasts show how hard outbreak months are to predict from synthetic data, and they are not forecasts for any real district.</section>
    <section class="panel stack">
      <div class="row" style="justify-content:space-between;align-items:flex-end">${selectorsHTML(meta, getSelection(), { idPrefix: "md" })}
        <p class="small" style="max-width:50ch">Error unit: cases per 100,000 per month. Outbreak months are test months above 1.2 × the 2015–2021 median for that calendar month.</p></div>
      <div id="md-kpis">${loadingHTML("Loading model results… The first request on a new server fits the models, which can take up to a minute.")}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2 id="md-chart-title">Actual cases and model forecasts</h2><span class="small">Shaded months are outbreak months</span></div>
      <div class="row" id="md-toggles" role="group" aria-label="Models shown on the chart" style="margin-bottom:8px"></div>
      <div id="md-legend"></div>
      <div id="md-chart"></div>
    </section>
    <section class="grid cols-2">
      <div class="panel"><div class="panel-head"><h2>Error in outbreak months vs other months ${infoTip("outbreak_month")}</h2><span class="small">Mean absolute error ${infoTip("mae")}</span></div><div id="md-ob"></div></div>
      <div class="panel"><div class="panel-head"><h2>What the random forest relies on</h2><span class="small">Feature importance (share of total), trained per disease on all districts</span></div><div id="md-imp"></div></div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Model comparison ${infoTip("mae")} ${infoTip("rmse")} ${infoTip("bias")}</h2><span class="small" id="md-table-sub"></span></div><div id="md-table"></div></section>
    <section class="panel"><div class="panel-head"><h2 id="md-sum-title">Every district</h2><span class="small">MAE per model; the lowest in each row is marked</span></div><div id="md-summary">${loadingHTML()}</div></section>`;
  bindSelects(view);

  let current = null;
  async function update() {
    const my = ++seq;
    const s = getSelection();
    view.querySelectorAll("select[data-key]").forEach((el) => (el.value = s[el.dataset.key]));
    view.querySelector("#md-kpis").style.opacity = ".55";
    let f;
    try {
      f = await api.forecasts({ district: s.district, disease: s.disease });
    } catch (err) {
      if (my === seq) { view.querySelector("#md-kpis").style.opacity = "1"; view.querySelector("#md-kpis").innerHTML = errorHTML(err); }
      return;
    }
    if (my !== seq) return;
    current = f;
    const dist = byId(meta.districts, s.district), dis = byId(meta.diseases, s.disease);
    const naive = f.models.find((m) => m.id === "seasonal_naive");
    const sm = f.models.filter((m) => m.converged != null);
    const kp = view.querySelector("#md-kpis");
    kp.style.opacity = "1";
    kp.innerHTML = `<div class="kpis">
      <article class="kpi kpi-primary"><div class="kpi-label">Lowest error</div><div class="kpi-value">${fmtNum(f.best_model.mae, 3)}<span class="unit">MAE</span></div><div class="kpi-compare"><span>${esc(f.best_model.label)}</span><span class="muted">${esc(dis.name)} in ${esc(dist.name)}, 2022–2024</span></div></article>
      <article class="kpi"><div class="kpi-label">Seasonal naive benchmark</div><div class="kpi-value">${fmtNum(naive.mae, 3)}<span class="unit">MAE</span></div><div class="kpi-compare"><span>Repeats 2021 month by month</span><span class="muted">Bias ${fmtSigned(naive.bias, 3)} (negative = under-predicts)</span></div></article>
      <article class="kpi"><div class="kpi-label">Outbreak months in the test</div><div class="kpi-value">${naive.n_outbreak}<span class="unit">of ${naive.n}</span></div><div class="kpi-compare"><span>Naive MAE ${fmtNum(naive.mae_outbreak, 2)} in outbreak months vs ${fmtNum(naive.mae_other, 2)} otherwise</span></div></article>
      <article class="kpi"><div class="kpi-label">Statistical fits converged</div><div class="kpi-value">${sm.filter((m) => m.converged).length}<span class="unit">of ${sm.length}</span></div><div class="kpi-compare"><span>ARIMA family, maximum likelihood</span>${f.fit_info?.convergence_warnings ? `<span class="muted">${f.fit_info.convergence_warnings} convergence warnings suppressed</span>` : ""}</div></article>
    </div>`;
    view.querySelector("#md-chart-title").textContent = `Actual cases and model forecasts · ${dis.name} in ${dist.name}`;
    drawToggles(f);
    drawChart(f);

    barChart(view.querySelector("#md-ob"), {
      categories: f.models.map((m) => m.label), unit: "MAE (per 100k)", valueFmt: (v) => fmtNum(v, 2), height: 240,
      series: [{ label: "Outbreak months", color: "var(--c2)", values: f.models.map((m) => m.mae_outbreak) },
        { label: "Other months", color: "var(--c1)", values: f.models.map((m) => m.mae_other) }],
      ariaLabel: "Mean absolute error in outbreak months and in other months for each model",
    });
    view.querySelector("#md-ob").insertAdjacentHTML("afterbegin", seriesLegendHTML([{ label: "Outbreak months", color: "var(--c2)" }, { label: "Other months", color: "var(--c1)" }]));

    const rf = f.models.find((m) => m.id === "random_forest");
    const imp = rf.feature_importance || [];
    const top = Math.max(...imp.map((x) => x.importance), 1e-9);
    const featLabel = (n) => n.replace("rainfall_mm", "Rainfall").replace("mean_temperature_c", "Temperature").replace("relative_humidity_pct", "Humidity")
      .replace(/_lag_0$/, ", same month").replace(/_lag_(\d)$/, ", $1-month lag").replace("month_sin", "Season (sine)").replace("month_cos", "Season (cosine)");
    view.querySelector("#md-imp").innerHTML = `<ul class="hbars">${imp.map((x) => `<li><span class="hb-label">${esc(featLabel(x.feature))}</span><span class="hb-track"><span class="hb-bar" style="width:${(x.importance / top) * 100}%"></span></span><span class="hb-val">${fmtNum(x.importance * 100, 1)}%</span></li>`).join("")}</ul>`;

    view.querySelector("#md-table-sub").textContent = `${dis.name} in ${dist.name} · test months ${f.test_period.start} to ${f.test_period.end}`;
    view.querySelector("#md-table").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Model</th><th>Climate inputs</th><th class="n">MAE</th><th class="n">RMSE</th><th class="n">Bias</th><th class="n">MAE outbreak</th><th class="n">MAE other</th><th>Fit</th><th>Notebook</th></tr></thead><tbody>
      ${f.models.map((m) => `<tr ${m.id === f.best_model.id ? 'class="row-default"' : ""}><td><b>${esc(m.label)}</b>${m.id === f.best_model.id ? " ★" : ""}<div class="small">${esc(m.detail)}</div></td><td>${m.climate ? "Yes" : "No"}</td><td class="n">${fmtNum(m.mae, 3)}</td><td class="n">${fmtNum(m.rmse, 3)}</td><td class="n">${fmtSigned(m.bias, 3)}</td><td class="n">${fmtNum(m.mae_outbreak, 3)}</td><td class="n">${fmtNum(m.mae_other, 3)}</td><td>${m.converged == null ? '<span class="small">n/a</span>' : passPill(m.converged, "converged", "not converged")}</td><td class="mono">${esc(m.notebook)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small" style="margin-top:8px">${f.notes.map(esc).join(" ")}</p>`;
  }

  function drawToggles(f) {
    const host = view.querySelector("#md-toggles");
    host.innerHTML = f.models.map((m, k) => `<button type="button" class="toggle" data-model="${esc(m.id)}" aria-pressed="${shown.has(m.id)}"><span class="swatch" style="background:${CAT[k]}"></span>${esc(m.label)}</button>`).join("");
    host.querySelectorAll("[data-model]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.model;
      if (shown.has(id)) shown.delete(id); else shown.add(id);
      b.setAttribute("aria-pressed", String(shown.has(id)));
      if (current) drawChart(current);
    }));
  }

  function drawChart(f) {
    const series = [{ label: "Actual (synthetic)", values: f.actual_per_100k, color: "var(--ink)", width: 2.6 }];
    f.models.forEach((m, k) => { if (shown.has(m.id)) series.push({ label: m.label, values: m.predictions, color: CAT[k], width: 1.7, dash: m.id === "seasonal_naive" ? "5 4" : null }); });
    const bands = [];
    f.outbreak_months.forEach((o, i) => { if (o) bands.push({ start: f.months[i], end: f.months[i], fill: "var(--crit-soft)", stroke: "transparent" }); });
    view.querySelector("#md-legend").innerHTML = seriesLegendHTML(series, '<span><span class="swatch" style="background:var(--crit-soft);border:1px solid var(--crit)"></span>Outbreak month</span>');
    timeChart(view.querySelector("#md-chart"), { months: f.months, range: [0, f.months.length - 1], unit: "Cases per 100k", series, bands,
      valueFmt: (v) => fmtNum(v, 2), notesAt: (m) => (f.outbreak_months[f.months.indexOf(m)] ? ["Outbreak month"] : []),
      ariaLabel: "Actual synthetic cases per 100,000 and model forecasts for 2022 to 2024, with outbreak months shaded" });
  }

  async function summary() {
    const s = getSelection();
    const dis = byId(meta.diseases, s.disease);
    view.querySelector("#md-sum-title").textContent = `Every district · ${dis.name}`;
    try {
      const fs = await api.forecastSummary({ disease: s.disease });
      if (getSelection().disease !== s.disease) return;
      const ids = fs.models.map((m) => m.id);
      const row = (label, vals) => {
        const best = Math.min(...vals.filter((v) => v != null));
        return `<tr><td>${label}</td>${vals.map((v) => `<td class="n ${v === best ? "cell-best" : ""}">${fmtNum(v, 3)}${v === best ? " ★" : ""}</td>`).join("")}</tr>`;
      };
      view.querySelector("#md-summary").innerHTML = `<div class="table-wrap"><table><thead><tr><th>District</th>${fs.models.map((m) => `<th class="n">${esc(m.label)}</th>`).join("")}</tr></thead><tbody>
        ${fs.districts.map((r) => row(esc(byId(meta.districts, r.district)?.name || r.district), ids.map((id) => r[id]))).join("")}
        ${row("<b>All five districts (pooled)</b>", ids.map((id) => fs.pooled.find((p) => p.id === id)?.mae))}</tbody></table></div>
        <p class="small" style="margin-top:8px">${fs.notes.map(esc).join(" ")} Pooled MAE averages all 180 test months.</p>`;
    } catch (err) {
      view.querySelector("#md-summary").innerHTML = errorHTML(err);
    }
  }

  let lastDisease = null;
  const off = onSelection(() => { update(); if (getSelection().disease !== lastDisease) { lastDisease = getSelection().disease; summary(); } });
  lastDisease = getSelection().disease;
  await update();
  summary();
  return off;
}
