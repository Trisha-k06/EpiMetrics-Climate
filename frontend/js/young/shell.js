// Young Minds: a separate, playful shell for school students. Big buttons and pictures, no typing, no saving, no
// comments, no exports, no ground truth. Results are the real API values for the matching predefined scenario.
// Badges are kept in this browser only. It imports nothing from the analyst screens.
import { api, track } from "../api.js";
import { esc, byId, monthLabel } from "../format.js";
import { getSelection, setSelection } from "../state.js";
import { GLOSSARY } from "../glossary.js";
import { errorHTML } from "../ui.js";
import { sun, cloud, mosquito, puddle, thermometer, buddy, badgeIcon } from "./art.js";

const TABS = [
  { id: "young-explore", label: "Explore", icon: "🗺️" },
  { id: "young-lab", label: "Climate lab", icon: "🧪" },
  { id: "young-quiz", label: "Quiz & badges", icon: "🏅" },
  { id: "young-glossary", label: "Glossary", icon: "📖" },
];
const BADGE_KEY = "epimetrics.young.badges.v1";
const BADGES = [
  { id: "map", name: "Map explorer", how: "Visit all 5 places" },
  { id: "wizard", name: "Weather wizard", how: "Try 3 weather experiments" },
  { id: "quiz", name: "Quiz champion", how: "Get every quiz question right" },
  { id: "words", name: "Word finder", how: "Open 6 glossary words" },
];

// ---------- browser-only progress (a per-device convenience; nothing is sent or stored on the server) ----------
function progress() {
  try { return JSON.parse(localStorage.getItem(BADGE_KEY) || "null") || { places: [], experiments: [], words: [], quiz: false }; } catch { return { places: [], experiments: [], words: [], quiz: false }; }
}
function saveProgress(p) { try { localStorage.setItem(BADGE_KEY, JSON.stringify(p)); } catch { /* storage unavailable: badges just won't persist */ } }
function earned(p) {
  return { map: p.places.length >= 5, wizard: p.experiments.length >= 3, quiz: !!p.quiz, words: p.words.length >= 6 };
}
function note(kind, value) {
  const p = progress();
  const before = earned(p);
  if (kind === "quiz") p.quiz = true; else if (!p[kind].includes(value)) p[kind].push(value);
  saveProgress(p);
  const after = earned(p);
  const fresh = BADGES.find((b) => after[b.id] && !before[b.id]);
  if (fresh) celebrate(fresh);
}
function celebrate(b) {
  const el = document.createElement("div");
  el.className = "y-celebrate";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="y-badge earned">${badgeIcon(b.id)}</div><b>New badge: ${esc(b.name)}!</b>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- the weather controls map onto the 7 predefined scenarios ----------
function scenarioFor({ rain, heat, late, storm }) {
  if (late) return "delayed_monsoon";
  if (storm) return "heavy_rain_decline";
  if (heat && rain >= 1) return "warm_wet";
  if (heat) return "warmer";
  if (rain === 1) return "prolonged_wet";
  if (rain === 2) return "irregular_rain";
  return "baseline";
}
const STORY = {
  baseline: ["☀️ Normal weather", "🦟 The usual number of mosquitoes", "📅 Sickness calms down at its usual speed"],
  prolonged_wet: ["🌧️ Rain for many weeks", "💧 Lots of puddles stay around", "🦟 More mosquito homes", "📅 It takes longer to calm down"],
  irregular_rain: ["🌦️ Rain, stop, rain again", "💧 Puddles keep coming back", "🦟 Mosquitoes keep returning", "📅 Sickness keeps bouncing back"],
  delayed_monsoon: ["⏰ The big rains come late", "💧 Puddles appear just as things were calming", "🦟 A new wave of mosquitoes", "📅 Calming down is pushed later"],
  heavy_rain_decline: ["⛈️ One giant storm", "💧 Sudden puddles everywhere", "🦟 Mosquitoes get a surprise boost", "📅 It takes longer to calm down"],
  warmer: ["🌡️ Hotter days", "🥵 In this pretend world it's too hot for the mosquitoes", "📅 Sickness can calm down sooner"],
  warm_wet: ["🌡️ Hotter days and 🌧️ more rain", "🦟 Heat slows the pretend mosquitoes, rain helps them", "📅 The two effects push against each other"],
};

const BANNER = `<div class="y-banner" role="note">${buddy(40)}<p><b>This is pretend (synthetic) data for learning.</b> It is not real health advice and not real Tamil Nadu numbers.</p></div>`;

export async function render(view, { meta, screen }) {
  const tab = TABS.find((t) => t.id === screen) || TABS[0];
  view.innerHTML = `<div class="young">
    ${BANNER}
    <nav class="y-tabs" aria-label="Young Minds">${TABS.map((t) => `<a href="#${t.id}" class="y-tab" ${t.id === tab.id ? 'aria-current="page"' : ""}><span aria-hidden="true">${t.icon}</span>${esc(t.label)}</a>`).join("")}</nav>
    <div class="y-body" id="y-body"></div>
    ${helperHTML()}
  </div>`;
  bindHelper(view);
  const body = view.querySelector("#y-body");
  track("young_activity", { screen: tab.id });
  const run = { "young-explore": explore, "young-lab": lab, "young-quiz": quiz, "young-glossary": glossary }[tab.id];
  return run(body, meta);
}

// ---------------------------------------------------------------------------- Explore
let geoPromise = null;
const loadGeo = () => (geoPromise ||= fetch("data/geo/tamil_nadu.json").then((r) => { if (!r.ok) throw new Error("The map could not be loaded."); return r.json(); }));

async function explore(body, meta) {
  const p = progress();
  body.innerHTML = `
    <section class="y-scene" aria-label="A sunny and rainy sky over Tamil Nadu">
      <div class="y-sky">${sun(92)}${cloud(150)}${cloud(120, true)}</div>
      <div class="y-hello"><h1>Hello, climate explorer!</h1>
        <p>Mosquitoes love warm weather and puddles. When the weather changes, sickness they spread can take longer, or shorter, to calm down. Let's find out how!</p>
        <a class="y-big" href="#young-lab">🧪 Start an experiment</a></div>
      <div class="y-critters">${mosquito(64)}${puddle(130)}</div>
    </section>
    <section class="y-card"><h2>Pick a place in Tamil Nadu</h2>
      <div class="y-map-wrap"><svg class="y-map" viewBox="0 0 300 330" role="img" aria-label="Stylised map of Tamil Nadu with five places"></svg>
      <div class="y-places">${meta.districts.map((d) => `<button type="button" class="y-place ${p.places.includes(d.id) ? "visited" : ""}" data-d="${esc(d.id)}" aria-pressed="${getSelection().district === d.id}">📍 ${esc(d.name)}</button>`).join("")}</div></div>
      <p class="y-fact" id="y-fact" aria-live="polite">Tap a place to learn something about it.</p>
    </section>`;
  try {
    const geo = await loadGeo();
    const outline = geo.state_outline;
    const pts = outline.flat(2);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min(280 / (x1 - x0), 310 / (y1 - y0));
    const P = ([x, y]) => [10 + (x - x0) * s, 10 + (y1 - y) * s];
    const path = outline.map((poly) => poly.map((ring) => ring.map((q, i) => `${i ? "L" : "M"}${P(q).map((v) => v.toFixed(1)).join(" ")}`).join("") + "Z").join("")).join("");
    const dots = meta.districts.map((d) => {
      const g = geo.districts.find((x) => x.name.toLowerCase() === d.name.toLowerCase());
      if (!g) return "";
      const [cx, cy] = P(g.anchor);
      const below = d.id === "tnj" || d.id === "mdu"; // keep neighbouring labels apart
      return `<g class="y-dot" data-d="${esc(d.id)}"><circle cx="${cx}" cy="${cy}" r="11"/><text x="${cx}" y="${below ? cy + 27 : cy - 16}" text-anchor="middle">${esc(d.name)}</text></g>`;
    }).join("");
    body.querySelector(".y-map").innerHTML = `<path class="y-land" d="${path}"/>${dots}`;
  } catch (err) {
    body.querySelector(".y-map-wrap").insertAdjacentHTML("afterbegin", errorHTML(err));
  }
  const fact = body.querySelector("#y-fact");
  const choose = (id) => {
    const d = byId(meta.districts, id);
    setSelection({ district: id });
    body.querySelectorAll(".y-place").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.d === id)));
    body.querySelector(`.y-place[data-d="${id}"]`)?.classList.add("visited");
    fact.innerHTML = `<b>${esc(d.name)}</b> is ${d.climate_zone === "coastal" ? "by the sea, where the big rains come in autumn" : d.climate_zone === "inland" ? "inland, with two smaller rainy seasons" : "a warm place"}. In our pretend town about ${Math.round(d.population_illustrative / 100000) / 10} million people live there. <a href="#young-lab">Try the weather lab here →</a>`;
    note("places", id);
  };
  body.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.d)));
}

// ---------------------------------------------------------------------------- Climate lab
async function lab(body, meta) {
  const sel = getSelection();
  const st = { district: sel.district, disease: sel.disease, rain: 0, heat: 0, late: false, storm: false };
  let seq = 0;
  body.innerHTML = `
    <section class="y-card y-lab">
      <h1>Climate lab</h1>
      <div class="y-row"><span class="y-label">Place</span><div class="y-chips">${meta.districts.map((d) => `<button type="button" class="y-chip" data-district="${esc(d.id)}" aria-pressed="${d.id === st.district}">${esc(d.name)}</button>`).join("")}</div></div>
      <div class="y-row"><span class="y-label">Sickness</span><div class="y-chips">${meta.diseases.map((d) => `<button type="button" class="y-chip" data-disease="${esc(d.id)}" aria-pressed="${d.id === st.disease}">🦟 ${esc(d.name)}</button>`).join("")}</div></div>
      <div class="y-controls">
        <div class="y-control">${cloud(80, true)}<label for="y-rain">Make it rain more</label>
          <input type="range" id="y-rain" min="0" max="2" step="1" value="0" aria-valuetext="Normal rain"><div class="y-ticks"><span>Normal</span><span>Lots</span><span>On and off</span></div></div>
        <div class="y-control">${thermometer(44)}<label for="y-heat">Make it hotter</label>
          <input type="range" id="y-heat" min="0" max="1" step="1" value="0" aria-valuetext="Normal heat"><div class="y-ticks"><span>Normal</span><span>Hotter</span></div></div>
        <div class="y-control y-buttons">
          <button type="button" class="y-big y-toggle" id="y-late" aria-pressed="false">⏰ Monsoon comes late</button>
          <button type="button" class="y-big y-toggle" id="y-storm" aria-pressed="false">⛈️ One giant storm</button>
          <button type="button" class="y-link" id="y-reset">Back to normal weather</button>
        </div>
      </div>
    </section>
    <section class="y-card" id="y-result" aria-live="polite"></section>`;
  const rain = body.querySelector("#y-rain"), heat = body.querySelector("#y-heat");
  const late = body.querySelector("#y-late"), storm = body.querySelector("#y-storm");
  const sync = () => {
    rain.value = st.rain; heat.value = st.heat;
    rain.setAttribute("aria-valuetext", ["Normal rain", "Lots of rain", "Rain on and off"][st.rain]);
    heat.setAttribute("aria-valuetext", st.heat ? "Hotter" : "Normal heat");
    late.setAttribute("aria-pressed", String(st.late));
    storm.setAttribute("aria-pressed", String(st.storm));
    body.querySelectorAll("[data-district]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.district === st.district)));
    body.querySelectorAll("[data-disease]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.disease === st.disease)));
  };
  rain.addEventListener("change", () => { st.rain = Number(rain.value); st.late = st.storm = false; go(); });
  heat.addEventListener("change", () => { st.heat = Number(heat.value); st.late = st.storm = false; go(); });
  late.addEventListener("click", () => { st.late = !st.late; st.storm = false; go(); });
  storm.addEventListener("click", () => { st.storm = !st.storm; st.late = false; go(); });
  body.querySelector("#y-reset").addEventListener("click", () => { Object.assign(st, { rain: 0, heat: 0, late: false, storm: false }); go(); });
  body.querySelectorAll("[data-district]").forEach((b) => b.addEventListener("click", () => { st.district = b.dataset.district; setSelection({ district: st.district }); go(); }));
  body.querySelectorAll("[data-disease]").forEach((b) => b.addEventListener("click", () => { st.disease = b.dataset.disease; setSelection({ disease: st.disease }); go(); }));

  async function go() {
    sync();
    const my = ++seq;
    const scenario = scenarioFor(st);
    const out = body.querySelector("#y-result");
    out.style.opacity = ".6";
    try {
      const sim = await api.simulation({ district: st.district, disease: st.disease, scenario });
      if (my !== seq) return;
      out.style.opacity = "1";
      out.innerHTML = journeyHTML(sim, meta, scenario);
      track("young_activity", { screen: "young-lab", district: st.district, disease: st.disease, scenario });
      if (scenario !== "baseline") note("experiments", scenario);
    } catch (err) {
      if (my === seq) { out.style.opacity = "1"; out.innerHTML = errorHTML(err); }
    }
  }
  go();
}

function journeyHTML(sim, meta, scenario) {
  const rec = sim.recovery, s = rec.scenario, b = rec.baseline;
  const scen = byId(meta.scenarios, scenario), dist = byId(meta.districts, sim.request.district), dis = byId(meta.diseases, sim.request.disease);
  const months = sim.months, t0 = months.indexOf(sim.reference.t0_month);
  const recovered = s.status === "recovered";
  const n = recovered ? s.tsr_months : (s.tsr_lower_bound_months ?? 0);
  // TSR counts months from the peak to the FIRST calm month, so the busy stones stop one month before it.
  const stones = Array.from({ length: recovered ? Math.max(n - 1, 0) : n }, (_, k) => months[t0 + k + 1]).filter(Boolean);
  const calm = recovered ? [0, 1, 2].map((k) => months[t0 + n + k]).filter(Boolean) : [];
  const head = scenario === "baseline" ? `With <b>normal weather</b>, ${esc(dis.name.toLowerCase())} in ${esc(dist.name)} takes <b>${n} months</b> to calm down.`
    : recovered ? `With <b>${esc(scen.label.toLowerCase())}</b>, it takes <b>${n} months</b> to calm down${b.status === "recovered" ? ` (normal weather: ${b.tsr_months} months)` : ""}.`
      : `With <b>${esc(scen.label.toLowerCase())}</b>, it had <b>not calmed down yet</b> when our pretend diary ended, more than ${n} months later!`;
  const max = Math.max(n, b.tsr_months || 0, 1);
  return `<h2>The recovery journey</h2>
    <p class="y-answer">${head}</p>
    <p class="small">We used the "${esc(scen.label)}" experiment. The numbers come from the simulator's pretend data.</p>
    <ol class="y-journey" aria-label="${n} months from the busiest sickness month to back to normal">
      <li class="y-stone peak" style="--i:0"><span>🔥</span><small>${esc(monthLabel(sim.reference.t0_month, "short"))}<br>busiest</small></li>
      ${stones.map((m, k) => `<li class="y-stone" style="--i:${k + 1}"><span>${k + 1}</span><small>${esc(monthLabel(m, "short"))}</small></li>`).join("")}
      ${calm.map((m, k) => `<li class="y-stone calm" style="--i:${n + k + 1}"><span>${k === 0 ? n : "😌"}</span><small>${esc(monthLabel(m, "short"))}${k === 0 ? "<br>calm" : ""}</small></li>`).join("")}
      <li class="y-stone goal ${recovered ? "" : "far"}" style="--i:${n + 4}"><span>${recovered ? "🏁" : "…"}</span><small>${recovered ? "back to normal" : "still going"}</small></li>
    </ol>
    <div class="y-bars" role="img" aria-label="Normal weather ${b.tsr_months ?? "unknown"} months, your weather ${n}${recovered ? "" : " or more"} months">
      <div class="y-bar"><span>Normal weather</span><i style="width:${((b.tsr_months || 0) / max) * 100}%"></i><b>${b.tsr_months ?? "—"} months</b></div>
      <div class="y-bar yours"><span>Your weather</span><i style="width:${(n / max) * 100}%"></i><b>${n}${recovered ? "" : "+"} months</b></div>
    </div>
    <div class="y-story" aria-label="What happened">${(STORY[scenario] || []).map((x, k) => `<div class="y-step">${esc(x)}</div>${k < STORY[scenario].length - 1 ? '<span class="y-arrow" aria-hidden="true">→</span>' : ""}`).join("")}</div>`;
}

// ---------------------------------------------------------------------------- Quiz & badges
async function quiz(body, meta) {
  const p = progress();
  const e = earned(p);
  body.innerHTML = `<section class="y-card"><h1>Quiz</h1><div id="y-quiz"><p>Getting the questions ready…</p></div></section>
    <section class="y-card"><h2>Your explorer badges</h2><p class="small">Badges are kept in this browser only.</p>
      <div class="y-badges">${BADGES.map((b) => `<div class="y-badge ${e[b.id] ? "earned" : ""}">${badgeIcon(b.id)}<b>${esc(b.name)}</b><small>${e[b.id] ? "Earned!" : esc(b.how)}</small></div>`).join("")}</div></section>`;
  const host = body.querySelector("#y-quiz");
  let Q;
  try {
    const [late, storm, base] = await Promise.all([
      api.simulation({ district: "cbe", disease: "dengue", scenario: "delayed_monsoon" }),
      api.simulation({ district: "chn", disease: "dengue", scenario: "heavy_rain_decline" }),
      api.simulation({ district: "chn", disease: "dengue", scenario: "baseline" }),
    ]);
    const lateD = late.recovery.delta_tsr_months, stormT = storm.recovery.scenario.tsr_months, baseT = base.recovery.baseline.tsr_months;
    Q = [
      { q: "What does this pretend data help us learn?", a: ["How long sickness takes to calm down", "What medicine to take", "Tomorrow's weather"], ok: 0 },
      { q: "Where do mosquitoes like to lay their eggs?", a: ["In still puddles of water", "In hot dry sand", "Up in the clouds"], ok: 0 },
      { q: `In Coimbatore, if the monsoon comes late, does dengue take longer to calm down?`, a: [`Yes, ${lateD} months longer`, "No, it is faster", "It stays exactly the same"], ok: lateD > 0 ? 0 : lateD < 0 ? 1 : 2 },
      { q: "In Chennai, which takes longer to calm down: normal weather or one giant storm?", a: [`The giant storm (${stormT} months)`, `Normal weather (${baseT} months)`, "They take the same time"], ok: stormT > baseT ? 0 : stormT < baseT ? 1 : 2 },
      { q: "Is this real Tamil Nadu health data?", a: ["No, it's pretend data for learning", "Yes, it's real", "It's tomorrow's news"], ok: 0 },
    ];
  } catch (err) { host.innerHTML = errorHTML(err); return; }
  let k = 0, right = 0;
  const show = () => {
    if (k >= Q.length) {
      host.innerHTML = `<p class="y-answer">You got <b>${right} of ${Q.length}</b> right! ${right === Q.length ? "🎉 Amazing!" : "Try again to get them all."}</p><button type="button" class="y-big" id="y-again">Play again</button>`;
      if (right === Q.length) note("quiz", true);
      host.querySelector("#y-again").addEventListener("click", () => { k = 0; right = 0; show(); });
      return;
    }
    const item = Q[k];
    host.innerHTML = `<p class="y-q"><span class="small">Question ${k + 1} of ${Q.length}</span><br>${esc(item.q)}</p>
      <div class="y-answers">${item.a.map((x, i) => `<button type="button" class="y-answer-btn" data-i="${i}">${esc(x)}</button>`).join("")}</div><p class="y-feedback" aria-live="polite"></p>`;
    host.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => {
      const good = Number(b.dataset.i) === item.ok;
      if (good) right += 1;
      host.querySelectorAll("[data-i]").forEach((x) => { x.disabled = true; if (Number(x.dataset.i) === item.ok) x.classList.add("right"); });
      if (!good) b.classList.add("wrong");
      const fb = host.querySelector(".y-feedback");
      fb.innerHTML = `${good ? "✅ Yes!" : "Not quite."} <button type="button" class="y-big" id="y-next">${k + 1 < Q.length ? "Next question" : "See my score"}</button>`;
      fb.querySelector("#y-next").addEventListener("click", () => { k += 1; show(); });
      fb.querySelector("#y-next").focus();
    }));
  };
  show();
}

// ---------------------------------------------------------------------------- Glossary
const KID_EXTRA = [
  { id: "mosquito", term: "Mosquito", kid: "A tiny flying insect. Some kinds can carry germs from one person to another." },
  { id: "monsoon", term: "Monsoon", kid: "The big rainy season. In Tamil Nadu a lot of the rain comes in autumn." },
  { id: "dengue", term: "Dengue", kid: "A sickness some mosquitoes can spread. Doctors help people who get it." },
  { id: "malaria", term: "Malaria", kid: "Another sickness spread by a different kind of mosquito." },
];
const KID_IDS = ["synthetic", "tsr", "delta_tsr", "threshold", "t0", "secondary_wave", "interruption", "baseline", "scenario", "censored", "outbreak_month", "per100k"];

function glossary(body) {
  const words = [...KID_EXTRA, ...KID_IDS.map((id) => ({ id, term: GLOSSARY[id].term, kid: GLOSSARY[id].kid }))];
  body.innerHTML = `<section class="y-card"><h1>Glossary</h1><p>Tap a word to see what it means.</p>
    <div class="y-words">${words.map((w) => `<button type="button" class="y-word" data-w="${esc(w.id)}" aria-expanded="false"><b>${esc(w.term)}</b><span hidden>${esc(w.kid)}</span></button>`).join("")}</div></section>`;
  body.querySelectorAll(".y-word").forEach((b) => b.addEventListener("click", () => {
    const span = b.querySelector("span");
    span.hidden = !span.hidden;
    b.setAttribute("aria-expanded", String(!span.hidden));
    if (!span.hidden) note("words", b.dataset.w);
  }));
}

// ---------------------------------------------------------------------------- helper (buttons only, no typing)
const HELP = [
  { q: "What is this place?", a: "A pretend weather lab. You change the weather and see how long sickness takes to calm down." },
  { q: "Why does rain matter?", a: "Rain makes puddles. Some mosquitoes lay eggs in still water, so more puddles can mean more mosquitoes." },
  { q: "Why can hot weather help here?", a: "In this pretend world, it gets too hot for the mosquitoes, so they slow down. Real life can be different!" },
  { q: "Is this real?", a: "No. It is pretend (synthetic) data made by a computer, just for learning." },
  { q: "I feel sick. What should I do?", a: "I can't help with health questions. Please talk to a parent, a teacher or a doctor straight away." },
];
function helperHTML() {
  return `<div class="y-helper"><button type="button" class="y-helper-btn" id="y-help-open" aria-expanded="false" aria-controls="y-help">${buddy(34)}<span>Ask Drop</span></button>
    <section class="y-help" id="y-help" hidden aria-label="Ask Drop, the helper"><header><b>Hi, I'm Drop!</b><button type="button" class="y-close" id="y-help-close" aria-label="Close">×</button></header>
      <div class="y-help-log" aria-live="polite"><p>Pick a question:</p></div>
      <div class="y-help-qs">${HELP.map((h, i) => `<button type="button" data-h="${i}">${esc(h.q)}</button>`).join("")}</div></section></div>`;
}
function bindHelper(view) {
  const open = view.querySelector("#y-help-open"), panel = view.querySelector("#y-help"), log = panel.querySelector(".y-help-log");
  const set = (on) => { panel.hidden = !on; open.setAttribute("aria-expanded", String(on)); if (on) panel.querySelector("[data-h]").focus(); };
  open.addEventListener("click", () => set(panel.hidden));
  view.querySelector("#y-help-close").addEventListener("click", () => { set(false); open.focus(); });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { set(false); open.focus(); } });
  panel.querySelectorAll("[data-h]").forEach((b) => b.addEventListener("click", () => {
    const h = HELP[Number(b.dataset.h)];
    log.innerHTML = `<p class="y-help-q">${esc(h.q)}</p><p class="y-help-a">${esc(h.a)}</p>`;
  }));
}
