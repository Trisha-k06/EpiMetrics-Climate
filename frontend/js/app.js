// App shell: sign-in first, then /meta, then routing between the ten screens. Data source, provenance, Day/Night mode.
import { CONFIG } from "./config.js";
import { api, clearApiCache } from "./api.js";
import { reconcileSelection } from "./state.js";
import { esc, monthLabel, disclaimerBody } from "./format.js";
import { errorHTML, loadingHTML, toast } from "./ui.js";
import { initTheme } from "./theme.js";
import { initAuth, onAuth, currentSession, canOpen, logout, minutesLeft } from "./auth.js";
import { ROLES } from "./platform-data.js";
import { mountAssistant, unmountAssistant } from "./assistant.js";
import * as login from "./screens/login.js";
import * as platform from "./screens/platform.js";
import * as overview from "./screens/overview.js";
import * as simulator from "./screens/simulator.js";
import * as recovery from "./screens/recovery.js";
import * as episodes from "./screens/episodes.js";
import * as explorer from "./screens/explorer.js";
import * as models from "./screens/models.js";
import * as validation from "./screens/validation.js";
import * as report from "./screens/report.js";
import * as technology from "./screens/technology.js";

const ROUTES = {
  overview: { mod: overview, title: "Overview" },
  simulator: { mod: simulator, title: "Scenario simulator" },
  recovery: { mod: recovery, title: "Recovery & recurrence" },
  episodes: { mod: episodes, title: "Outbreak episodes" },
  explorer: { mod: explorer, title: "Data explorer" },
  models: { mod: models, title: "Forecast models" },
  validation: { mod: validation, title: "Validation & limits" },
  report: { mod: report, title: "Scenario report" },
  technology: { mod: technology, title: "Technology & project summary" },
  platform: { mod: platform, title: "Users & security" },
};
const DEFAULT_ROUTE = "overview";
const PROVENANCE_IDLE = "Sign in to load the dataset";

const view = document.getElementById("view");
let meta = null;
let metaPromise = null;
let cleanup = null;
let routeSeq = 0;

function setBadge(state, text) {
  const b = document.getElementById("api-badge");
  b.dataset.state = state;
  document.getElementById("api-badge-text").textContent = text;
}

function currentRoute() {
  const h = location.hash.replace(/^#/, "");
  return ROUTES[h] ? h : DEFAULT_ROUTE;
}

function runCleanup() {
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
}

// /meta needs a token, so it is loaded only after sign-in, and dropped on every auth change.
function resetData() {
  clearApiCache();
  meta = null;
  metaPromise = null;
  unmountAssistant();
  document.getElementById("provenance").textContent = PROVENANCE_IDLE;
  setBadge("pending", "Not signed in");
}

async function loadMeta() {
  if (meta) return meta;
  if (!metaPromise) {
    setBadge("pending", "Connecting to the API…");
    metaPromise = api.meta().then((m) => {
      meta = m;
      setBadge("live", `Live API · v${m.api_version}`);
      document.getElementById("disclaimer-text").textContent = disclaimerBody(m);
      document.getElementById("provenance").innerHTML = [
        `Dataset v${esc(m.dataset_version)} (generator v${esc(m.generator_version)})`,
        `Seed ${esc(m.seed)}`,
        `Recovery rule ${esc(m.recovery_rule.id)}`,
        `${monthLabel(m.horizon.start_month)} – ${monthLabel(m.horizon.end_month)}`,
        `Source: FastAPI backend at ${esc(CONFIG.API_BASE)}`,
        "Synthetic data, not forecasts or clinical advice",
      ].map((t) => `<span>${t}</span>`).join("");
      reconcileSelection(m);
      return m;
    }).catch((err) => {
      metaPromise = null;
      setBadge("error", "Backend unreachable");
      throw err;
    });
  }
  return metaPromise;
}

let lastAuthReason = null;
function updateShell() {
  const sess = currentSession();
  document.body.classList.toggle("signed-out", !sess);
  const chip = document.getElementById("user-chip");
  if (sess) {
    chip.hidden = false;
    chip.innerHTML = `<span class="uc-name" title="Signed in as ${esc(sess.username)}">${esc(sess.display_name)}</span><span class="uc-role">${esc(ROLES[sess.role].label)}</span><button type="button" class="uc-out" id="uc-out">Sign out</button>`;
    chip.querySelector("#uc-out").addEventListener("click", () => logout("logout"));
  } else { chip.hidden = true; chip.innerHTML = ""; }
  document.querySelectorAll(".sidenav a").forEach((a) => { a.hidden = !!sess && !canOpen(a.dataset.route); });
  if (meta && sess) mountAssistant(meta); else unmountAssistant();
  measureTopbar();
}

async function go() {
  const name = currentRoute();
  const my = ++routeSeq;
  updateShell();
  runCleanup();
  if (!currentSession()) {
    document.title = "Sign in · EpiMetrics-Climate Simulator";
    document.querySelectorAll(".sidenav a").forEach((a) => a.removeAttribute("aria-current"));
    await login.render(view, { reason: lastAuthReason });
    return;
  }
  if (!meta) {
    view.innerHTML = loadingHTML("Loading the dataset description…");
    try {
      await loadMeta();
    } catch (err) {
      if (my !== routeSeq || !currentSession()) return;
      view.innerHTML = errorHTML(err, "boot-retry");
      view.querySelector("#boot-retry")?.addEventListener("click", go);
      return;
    }
    if (my !== routeSeq) return;
    updateShell();
  }
  if (!canOpen(name)) {
    const r = ROLES[currentSession().role];
    view.innerHTML = `<div class="state" role="alert"><b>${esc(r.label)} accounts can't open this screen</b><span>Ask an admin for an Analyst account, or go back to the <a href="#overview">Overview</a>.</span></div>`;
    return;
  }
  document.querySelectorAll(".sidenav a").forEach((a) => {
    if (a.dataset.route === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.title = `${ROUTES[name].title} · EpiMetrics-Climate Simulator`;
  view.innerHTML = loadingHTML();
  try {
    const off = await ROUTES[name].mod.render(view, { meta });
    if (my === routeSeq) cleanup = off; else if (typeof off === "function") off();
  } catch (err) {
    if (my !== routeSeq) return;
    if (err?.code !== "unauthorized") console.error(err);
    if (currentSession()) view.innerHTML = errorHTML(err);
  }
  if (my === routeSeq && document.activeElement?.closest?.(".sidenav")) view.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function measureTopbar() {
  const h = document.querySelector(".topbar")?.offsetHeight || 96;
  document.documentElement.style.setProperty("--topbar-h", `${h}px`);
}

// Gentle 3D tilt that follows the mouse on cards marked .tilt.
function initTilt() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  let last = null;
  document.addEventListener("pointermove", (e) => {
    const el = e.pointerType === "mouse" ? e.target.closest?.(".tilt") : null;
    if (last && last !== el) { last.style.removeProperty("--rx"); last.style.removeProperty("--ry"); }
    last = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${(px * 7).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-py * 7).toFixed(2)}deg`);
  }, { passive: true });
}

function boot() {
  initTheme();
  initAuth();
  initTilt();
  measureTopbar();
  window.addEventListener("resize", measureTopbar);
  resetData();
  window.addEventListener("hashchange", go);
  onAuth((sess, reason) => {
    if (reason === "tick") {
      if (sess && minutesLeft() === 1) toast("You will be signed out in about a minute unless you keep working.");
      return;
    }
    lastAuthReason = reason;
    runCleanup();
    resetData();
    if (reason === "timeout") toast("Signed out after 15 minutes without activity");
    if (reason === "expired") toast("Your session expired. Sign in again.");
    if (reason === "logout") toast("Signed out");
    go();
  });
  go();
}

boot();
