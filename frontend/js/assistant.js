// Basic assistant: a rule-based chat panel. No AI service and no internet: answers come from the project's
// definitions (/meta) and from API results for the district, disease and scenario in the question.
// It never computes recovery and refuses medical questions.
import { api } from "./api.js";
import { getSelection, setSelection } from "./state.js";
import { esc, monthLabel, byId, tsrText, deltaText, anomalyText, plural } from "./format.js";
import { END_USERS, SECURITY, SAAS } from "./platform-data.js";
import { currentSession, access, can } from "./auth.js";
import { GLOSSARY } from "./glossary.js";

const SUGGESTIONS = ["What is TSR?", "Why does recovery take longer here?", "Which forecast model is best?", "How many outbreak episodes?", "Which scenario delays Chennai most?", "What does censored mean?", "Is this real data?"];

const DISTRICT_ALIASES = { chennai: "chn", madras: "chn", coimbatore: "cbe", kovai: "cbe", madurai: "mdu", trichy: "try", tiruchi: "try", tiruchirappalli: "try", tiruchirapalli: "try", thanjavur: "tnj", tanjore: "tnj" };
const SCENARIO_ALIASES = [
  [/warm(er)?\s*(and|&|\+)?\s*wet/, "warm_wet"],
  [/delay(ed)?\s+monsoon|late\s+monsoon|monsoon\s+(delay|late)/, "delayed_monsoon"],
  [/extreme\s+rain|heavy\s+rain|rain(fall)?\s+pulse|cyclone|flood/, "heavy_rain_decline"],
  [/prolonged|wet\s+spell|long\s+wet/, "prolonged_wet"],
  [/irregular/, "irregular_rain"],
  [/warm(er|ing)?|heat|hotter|temperature\s+rise|\+1\.5/, "warmer"],
  [/baseline|normal\s+climate|no\s+anomaly/, "baseline"],
];

function norm(t) { return String(t).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9+.\sδ-]/g, " ").replace(/\s+/g, " ").trim(); }

function entities(q) {
  const out = {};
  for (const [k, v] of Object.entries(DISTRICT_ALIASES)) if (new RegExp(`\\b${k}\\b`).test(q)) { out.district = v; break; }
  if (/\bdengue\b/.test(q)) out.disease = "dengue";
  else if (/\bmalaria\b/.test(q)) out.disease = "malaria";
  for (const [re, id] of SCENARIO_ALIASES) if (re.test(q)) { out.scenario = id; break; }
  return out;
}

const link = (hash, label, sel) => `<a href="#${esc(hash)}" class="as-link"${sel ? ` data-sel='${esc(JSON.stringify(sel))}'` : ""}>${esc(label)} →</a>`;

async function explainSeries(meta, sel, why) {
  const sim = await api.simulation(sel);
  const scen = byId(meta.scenarios, sel.scenario), dist = byId(meta.districts, sel.district), dis = byId(meta.diseases, sel.disease);
  const end = meta.horizon.end_month, rec = sim.recovery;
  const b = tsrText(rec.baseline, end), t = tsrText(rec.scenario, end), d = deltaText(rec);
  const head = `<b>${esc(dis.name)} in ${esc(dist.name)}, ${esc(scen.label.toLowerCase())}</b> (from the API, synthetic data):`;
  if (sel.scenario === "baseline") {
    return `${head} the outbreak peaks in ${monthLabel(sim.reference.t0_month)} and sustained recovery takes <b>${esc(b.value)} ${esc(b.unit)}</b> under the baseline climate. Pick a climate scenario to see a delay.<br>${link("simulator", "Open in the simulator", sel)}`;
  }
  const waves = sim.waves.scenario.filter((w) => w.interrupts_recovery);
  let reason;
  if (rec.scenario.status === "not_recovered_within_horizon") reason = `It never reaches sustained recovery before ${monthLabel(end)}, so the delay is a minimum. ${waves.length ? `${plural(waves.length, "secondary wave")} keep restarting transmission, the first in ${monthLabel(waves[0].onset_month)}.` : ""}`;
  else if (d.tone === "slower" && waves.length) reason = `The main reason is ${waves.length === 1 ? "a secondary wave" : `${waves.length} secondary waves`} starting in ${monthLabel(waves[0].onset_month)} (peak ${monthLabel(waves[0].peak_month)}, ${waves[0].peak_cases} cases), which interrupts recovery before cases can stay below the threshold for 3 months.`;
  else if (d.tone === "slower") reason = "Cases stay above the endemic threshold for longer after the peak, so the 3 calm months needed for sustained recovery come later.";
  else if (d.tone === "faster") reason = "Recovery is faster here because, in this model, the changed climate moves conditions away from the assumed best temperature or rainfall for transmission. This follows from the model's assumptions, not real evidence.";
  else reason = "This climate change does not shift the recovery month in this district.";
  const climate = sim.anomaly_windows.length ? `<br>Climate change applied: ${sim.anomaly_windows.map((a) => esc(anomalyText(a))).join("; ")}.` : "";
  return `${head} recovery takes <b>${esc(t.value)} ${esc(t.unit)}</b> compared with ${esc(b.value)} under the baseline climate, so the recovery delay (ΔTSR) is <b>${esc(d.value)} ${esc(d.unit)}</b>. ${esc(reason)}${climate}<br>${link("simulator", "Open in the simulator", sel)}`;
}

async function worstScenario(meta, sel) {
  const m = await api.recoveryMatrix({ disease: sel.disease });
  const cells = m.cells.filter((c) => c.district === sel.district && c.scenario !== "baseline");
  const val = (c) => (c.delta_status === "computed" ? c.delta_tsr_months : c.delta_status === "lower_bound" ? c.delta_tsr_lower_bound_months : -Infinity);
  cells.sort((a, b) => val(b) - val(a));
  const top = cells[0];
  const dist = byId(meta.districts, sel.district), dis = byId(meta.diseases, sel.disease);
  if (!top) return "The API did not return results for that district.";
  const label = (c) => byId(meta.scenarios, c.scenario).label;
  const show = (c) => (c.delta_status === "computed" ? `${c.delta_tsr_months > 0 ? "+" : ""}${c.delta_tsr_months}` : c.delta_status === "lower_bound" ? `≥ +${c.delta_tsr_lower_bound_months}` : "n/a");
  return `For <b>${esc(dis.name)} in ${esc(dist.name)}</b>, the longest delay comes from <b>${esc(label(top))}</b>: ${esc(show(top))} months. All scenarios: ${cells.map((c) => `${esc(label(c))} ${esc(show(c))}`).join(" · ")}.<br>${link("recovery", "Compare on the district map", { district: sel.district, disease: sel.disease, scenario: top.scenario })}`;
}

async function bestModel(meta, sel) {
  const f = await api.forecasts({ district: sel.district, disease: sel.disease });
  const dist = byId(meta.districts, sel.district), dis = byId(meta.diseases, sel.disease);
  const ranked = [...f.models].sort((a, b) => a.mae - b.mae);
  const naive = f.models.find((m) => m.id === "seasonal_naive");
  return `For <b>${esc(dis.name)} in ${esc(dist.name)}</b> (test months 2022–2024, from the API), the lowest error comes from <b>${esc(f.best_model.label)}</b>: mean absolute error ${f.best_model.mae.toFixed(3)} cases per 100,000, against ${naive.mae.toFixed(3)} for the seasonal-naive benchmark. Ranking: ${ranked.map((m) => `${esc(m.label)} ${m.mae.toFixed(3)}`).join(" · ")}.<br>Every model errs most in outbreak months, and these are benchmarks: the project's outcome is recovery time, not case counts.<br>${link("models", "Open Forecast models", { district: sel.district, disease: sel.disease })}`;
}

async function episodeCount(meta, sel) {
  const e = await api.episodes({ disease: sel.disease });
  const t = e.totals, m = e.matched;
  const base = e.by_scenario.filter((r) => r.scenario === "baseline").map((r) => `${esc(byId(meta.diseases, r.disease)?.name)} ${r.episodes}`).join(", ");
  return `Across all 70 series (5 districts × 2 diseases × 7 scenarios, 2015–2024) there are <b>${t.episodes} outbreak episodes</b>: ${t.recovered} recovered and ${t.unresolved} unresolved at the end of the data, with ${t.interruptions} recovery interruptions. Under the baseline climate: ${base}. ${m.matched_episodes} of ${m.climate_episodes} climate-scenario episodes match a baseline episode's start month; their mean recovery delay is ${m.mean_delta_tsr_months.toFixed(2)} months.<br>${link("episodes", "Open Outbreak episodes")}`;
}

async function answer(meta, raw) {
  const q = norm(raw);
  if (!q) return "Type a question, or choose one of the suggestions.";
  if (/\b(treat|treatment|medicine|medication|symptom|fever|should i|diagnos|vaccin|hospital|doctor|cure|dose|tablet|infected|am i)\b/.test(q)) {
    return "I can't help with medical questions. This tool uses synthetic data for research, and nothing here is health advice. For symptoms or treatment, please contact a doctor or your local health service.";
  }
  if (/^(hi|hello|hey|vanakkam|good (morning|afternoon|evening))\b/.test(q)) {
    return "Hello. I answer questions about this project: what the measures mean, the scenarios, the results for a district, and how the platform works. Try a suggestion below.";
  }
  const e = entities(q);
  const sel = { ...getSelection(), ...e };
  const forecastQ = /\b(forecast|forecasting|model|models|arima|sarima|sarimax|random forest|mae|rmse|predict)\b/.test(q);
  const episodeQ = /\bepisodes?\b|how many outbreaks/.test(q);
  if ((forecastQ || episodeQ) && !can("analysis.read")) return "Forecast benchmarks and outbreak-episode statistics are part of the analyst screens. Your experience shows the recovery results: try \"Why does recovery take longer here?\".";
  if (forecastQ) return bestModel(meta, sel);
  if (episodeQ) return episodeCount(meta, sel);
  const dataQ = /\b(why|delay|longer|tsr|recover|how long|interrupt|wave|result|months?)\b|δ|\+\d+/.test(q);
  const askingDefinition = /\b(what is|what are|what does|define|meaning|mean)\b/.test(q);
  if (/\b(most|worst|longest|biggest|highest|which scenario)\b/.test(q)) return worstScenario(meta, sel);
  if (dataQ && (!askingDefinition || e.district || e.scenario) && (/\bwhy\b/.test(q) || e.district || e.scenario || e.disease || /\b(here|this|current|selected)\b/.test(q) || /\+\d+/.test(q))) {
    return explainSeries(meta, sel, /\bwhy\b/.test(q));
  }
  const r = meta.recovery_rule;
  if (/\b(delta|δ)\s*tsr\b|δtsr|recovery delay|\bdelay\b/.test(q)) return `<b>Recovery delay (ΔTSR)</b> is TSR under a climate scenario minus TSR under the baseline climate. A positive value means the changed climate makes recovery take longer. If a scenario never recovers by ${monthLabel(meta.horizon.end_month)}, the delay is shown as a minimum ("≥").`;
  if (/\btsr\b|sustained recovery|time to (sustained )?recovery/.test(q)) return `<b>Time to Sustained Recovery (TSR)</b>: ${esc(GLOSSARY.tsr.plain)} It is the project's main measure.`;
  if (/threshold|endemic|normal level/.test(q)) return `<b>Endemic threshold</b>: ${esc(r.threshold_definition)}. Cases at or below it count as normal.`;
  if (/\bt0\b|reference peak|\bpeak\b/.test(q)) return "<b>t0</b> is the outbreak peak in the baseline series (between Aug 2022 and Feb 2023). Every scenario measures recovery from this same month, so the comparison is fair.";
  if (/censor|not recovered|never recover|≥|greater than/.test(q)) return `<b>Censored</b> means the series never reached sustained recovery before ${monthLabel(meta.horizon.end_month)}, the end of the data. We then show the recovery time as a minimum ("≥ N months") instead of inventing a date.`;
  if (/secondary|recurr|interrupt|\bwave/.test(q)) return `<b>Secondary wave</b>: ${esc(r.interruption_definition)}. A wave that starts before sustained recovery is an <b>interruption</b>, and it is the main way a climate shift delays recovery.`;
  if (/insufficient|missing|gap|outage/.test(q)) return `<b>Insufficient data</b>: when more than ${Math.round(r.max_missing_frac * 100)}% of months after t0 are missing, the engine gives no recovery time rather than guessing. The Validation screen tests 4 missing-data cases. ${link("validation", "Open Validation & limits")}`;
  if (/real|synthetic|fake|actual|surveillance|true data/.test(q)) return "All data is <b>synthetic</b> (computer-generated). It is not Tamil Nadu surveillance data or a climate projection. Results show how the model behaves under its assumptions; they are not forecasts or medical advice.";
  if (/scenario|scenarios|climate change|anomal/.test(q)) {
    if (e.scenario) { const s = byId(meta.scenarios, e.scenario); return `<b>${esc(s.label)}</b>: ${esc(s.description)}. ${link("simulator", "Try it in the simulator", { scenario: s.id })}`; }
    return `There are ${meta.scenarios.length} climate scenarios: ${meta.scenarios.map((s) => `<b>${esc(s.label)}</b> (${esc(s.short)})`).join("; ")}.`;
  }
  if (/disease|dengue|malaria|mosquito|driver/.test(q)) return meta.diseases.map((d) => `<b>${esc(d.name)}</b> (${esc(d.vector)}): ${d.drivers.map(esc).join("; ")}.`).join("<br>") + "<br>These climate responses are assumptions still to be confirmed from literature.";
  if (/district|where|map|location/.test(q)) return `The study covers ${meta.districts.map((d) => esc(d.name)).join(", ")}. Their populations and climates are illustrative. The district map uses real Census 2011 boundaries (DataMeet, CC BY 4.0). ${link("recovery", "Open the district map")}`;
  if (/valid|accura|reliab|error|trust|correct/.test(q)) return `Because the data is synthetic, the true recovery time is known. The engine's estimates from noisy data are compared with it on the Validation screen: average error, how often the recovery status matches, missing-data tests and rule sensitivity. ${link("validation", "Open Validation & limits")}`;
  if (/who|user|use it|for whom|audience|stakeholder/.test(q)) return END_USERS.map((u) => `<b>${esc(u.name)}</b>: ${esc(u.task)}`).join("<br>");
  if (/saas|service|host|deploy|cloud|subscription|tier/.test(q)) return `${esc(SAAS.summary)}<br>${SAAS.tiers.map((t) => `<b>${esc(t.name)}</b> (${esc(t.price)}): ${esc(t.includes)}`).join("<br>")}`;
  if (/secur|login|sign in|password|role|session|permission|safe|hack|integrity|checksum/.test(q)) {
    const s = currentSession();
    return `${SECURITY.filter((m) => m.status === "app").map((m) => `<b>${esc(m.area)}</b>: ${esc(m.measure)}`).join("<br>")}${s ? `<br>You are using the <b>${esc(access().label)}</b> experience.` : ""}<br>${link("platform", "Open Users & security")}`;
  }
  if (/pdf|export|download|report|print/.test(q)) return `Analysts and admins can export: the Scenario report screen saves one scenario (PDF, JSON, CSV, print), and the Technology screen exports a summary PDF of the whole project. The server checks the role and logs every export first. ${link("report", "Open Scenario report")}`;
  if (/limit|weak|caveat|assumption/.test(q)) return meta.limitations.slice(0, 5).map((l) => `• ${esc(l)}`).join("<br>") + `<br>${link("validation", "All limitations")}`;
  if (/how (do|to)|use|navigate|screen|start|help/.test(q)) return `Start on the <b>Scenario simulator</b>: choose a district, disease and climate scenario, then read the KPI cards (TSR, ΔTSR, interruptions, status). The <b>Recovery & recurrence</b> screen compares every district on a map. ${link("simulator", "Open the simulator")}`;
  return `I can answer questions about TSR, ΔTSR, thresholds, secondary waves, the scenarios, results for a district ("Why is the delay in Coimbatore dengue so long?"), forecast models, outbreak episodes, validation, security and who the tool is for. I'm a basic assistant, so please rephrase or pick a suggestion.`;
}

export function mountAssistant(meta) {
  if (document.getElementById("assistant")) return;
  const root = document.createElement("div");
  root.id = "assistant";
  root.innerHTML = `
    <button type="button" class="as-fab" id="as-open" aria-expanded="false" aria-controls="as-panel">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg><span>Ask</span>
    </button>
    <section class="as-panel" id="as-panel" role="dialog" aria-label="EpiMetrics assistant" hidden>
      <header class="as-head">
        <div><p class="as-title">EpiMetrics assistant</p><p class="as-sub">Basic assistant · answers from project definitions and API results · not medical advice</p></div>
        <button type="button" class="as-close" id="as-close" aria-label="Close assistant">×</button>
      </header>
      <div class="as-log" id="as-log" role="log" aria-live="polite"></div>
      <div class="as-chips" id="as-chips">${SUGGESTIONS.map((s) => `<button type="button" class="as-chip">${esc(s)}</button>`).join("")}</div>
      <form class="as-form" id="as-form"><label for="as-input" class="visually-hidden">Your question</label>
        <input id="as-input" autocomplete="off" placeholder="Ask about TSR, a district, a scenario…" maxlength="300">
        <button type="submit" class="btn btn-primary">Send</button></form>
    </section>`;
  document.body.appendChild(root);
  const panel = root.querySelector("#as-panel"), open = root.querySelector("#as-open"), log = root.querySelector("#as-log"), input = root.querySelector("#as-input");
  const add = (who, html) => {
    const m = document.createElement("div");
    m.className = `as-msg as-${who}`;
    m.innerHTML = html;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  };
  let greeted = false;
  const show = (on) => {
    panel.hidden = !on;
    open.setAttribute("aria-expanded", String(on));
    if (on) {
      if (!greeted) { add("bot", "Hello. Ask me what a measure means, why a district recovers slowly, or how the platform works. I use the project's definitions and the current API results."); greeted = true; }
      input.focus();
    }
  };
  open.addEventListener("click", () => show(panel.hidden));
  root.querySelector("#as-close").addEventListener("click", () => { show(false); open.focus(); });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { show(false); open.focus(); } });
  const ask = async (text) => {
    add("user", esc(text));
    const wait = add("bot", '<span class="as-typing">Looking that up…</span>');
    try { wait.innerHTML = await answer(meta, text); } catch (err) { wait.innerHTML = `I couldn't get that from the API: ${esc(err.message)}`; }
    log.scrollTop = log.scrollHeight;
  };
  root.querySelector("#as-form").addEventListener("submit", (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ""; ask(t); });
  root.querySelectorAll(".as-chip").forEach((c) => c.addEventListener("click", () => ask(c.textContent)));
  log.addEventListener("click", (e) => {
    const a = e.target.closest("a.as-link");
    if (a?.dataset.sel) { try { setSelection(JSON.parse(a.dataset.sel)); } catch { /* ignore */ } }
  });
}

export function unmountAssistant() { document.getElementById("assistant")?.remove(); }
