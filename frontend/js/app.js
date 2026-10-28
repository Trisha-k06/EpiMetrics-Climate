// App shell: sign-in first, then /meta, then the screens this account may open. The nav, the home screen and every
// permission come from the server (GET /auth/me → backend/roles.py). Screens load on demand (dynamic import), so the
// Young Minds mode never downloads the analyst modules.
import { CONFIG } from "./config.js";
import { api, clearApiCache, track } from "./api.js";
import { reconcileSelection } from "./state.js";
import { esc, monthLabel, disclaimerBody } from "./format.js";
import { errorHTML, loadingHTML, toast } from "./ui.js";
import { initTheme } from "./theme.js";
import { initTooltips } from "./components/tooltip.js";
import { initAuth, onAuth, currentSession, access, canOpen, logout, minutesLeft, isPreview, setPreview } from "./auth.js";

const SCREENS = {
  overview: () => import("./screens/overview.js"),
  simulator: () => import("./screens/simulator.js"),
  map: () => import("./screens/map.js"),
  recovery: () => import("./screens/recovery.js"),
  compare: () => import("./screens/compare.js"),
  episodes: () => import("./screens/episodes.js"),
  explorer: () => import("./screens/explorer.js"),
  models: () => import("./screens/models.js"),
  validation: () => import("./screens/validation.js"),
  report: () => import("./screens/report.js"),
  technology: () => import("./screens/technology.js"),
  platform: () => import("./screens/platform.js"),
  admin: () => import("./screens/admin.js"),
  "young-explore": () => import("./young/shell.js"),
  "young-lab": () => import("./young/shell.js"),
  "young-quiz": () => import("./young/shell.js"),
  "young-glossary": () => import("./young/shell.js"),
};
const PROVENANCE_IDLE = "Sign in to load the dataset";

const view = document.getElementById("view");
let meta = null;
let metaPromise = null;
let cleanup = null;
let routeSeq = 0;
let assistantMod = null;

function setBadge(state, text) {
  const b = document.getElementById("api-badge");
  b.dataset.state = state;
  document.getElementById("api-badge-text").textContent = text;
}

function requestedRoute() { return decodeURIComponent(location.hash.replace(/^#/, "").split("?")[0]); }

function runCleanup() {
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
}

// /meta needs a token, so it is loaded only after sign-in, and dropped on every auth change.
function resetData() {
  clearApiCache();
  meta = null;
  metaPromise = null;
  assistantMod?.unmountAssistant();
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

const isYoung = () => access()?.role === "junior";

function buildNav() {
  const nav = document.getElementById("sidenav");
  const a = access();
  nav.innerHTML = a && !isYoung() ? a.screens.map((s, i) => `<a href="#${esc(s.id)}" data-route="${esc(s.id)}"><span class="nav-num">${i + 1}</span><span class="nav-label">${esc(s.label)}</span></a>`).join("") : "";
}

function updateShell() {
  const sess = currentSession();
  const a = access();
  document.body.classList.toggle("signed-out", !sess);
  document.body.classList.toggle("young-mode", !!sess && isYoung());
  document.body.dataset.role = sess ? a.role : "";
  const chip = document.getElementById("user-chip");
  if (sess) {
    chip.hidden = false;
    chip.innerHTML = `<span class="uc-name" title="Signed in as ${esc(sess.username)}">${esc(sess.display_name)}</span><span class="uc-role">${esc((sess.roles.find((r) => r.role === sess.role) || {}).label || sess.role)}</span><button type="button" class="uc-out" id="uc-out">Sign out</button>`;
    chip.querySelector("#uc-out").addEventListener("click", () => logout("logout"));
  } else { chip.hidden = true; chip.innerHTML = ""; }
  const strip = document.getElementById("preview-strip");
  if (sess && isPreview()) {
    strip.hidden = false;
    strip.innerHTML = `<div class="preview-inner"><b>Previewing as ${esc(a.label)}</b><span>Read-only: what this audience sees. Your own role has not changed.</span><button type="button" class="btn btn-sm" id="preview-exit">Exit preview</button></div>`;
    strip.querySelector("#preview-exit").addEventListener("click", async () => {
      try { await setPreview(null); location.hash = "admin"; } catch (err) { toast(err.message); }
    });
  } else { strip.hidden = true; strip.innerHTML = ""; }
  buildNav();
  if (meta && sess && !isYoung()) {
    (assistantMod ? Promise.resolve(assistantMod) : import("./assistant.js").then((m) => (assistantMod = m))).then((m) => { if (currentSession() && !isYoung()) m.mountAssistant(meta); });
  } else assistantMod?.unmountAssistant();
  measureTopbar();
}

async function go() {
  const my = ++routeSeq;
  updateShell();
  runCleanup();
  if (!currentSession()) {
    document.title = "Sign in · EpiMetrics-Climate Simulator";
    const login = await import("./screens/login.js");
    if (my === routeSeq) await login.render(view, { reason: lastAuthReason });
    return;
  }
  const a = access();
  if (!a.screens.length) {
    view.innerHTML = `<div class="state" role="alert"><b>No screens are available for this account yet</b><span>Ask an admin to give your account a role.</span></div>`;
    return;
  }
  let name = requestedRoute();
  if (!name) { name = a.home; history.replaceState(null, "", `#${name}`); }
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
  document.querySelectorAll(".sidenav a").forEach((el) => {
    if (el.dataset.route === name) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
  });
  if (!SCREENS[name] || !canOpen(name)) {
    const home = a.screens[0];
    document.title = "Not available · EpiMetrics-Climate Simulator";
    view.innerHTML = `<div class="state not-available" role="alert"><b>${SCREENS[name] ? "This screen isn't part of your account" : "There is no screen with this address"}</b>
      <span>${SCREENS[name] ? `${esc(a.label)} accounts see the screens in the menu. Ask an admin if you need more.` : "Check the link, or start from your home screen."}</span>
      <a class="btn btn-primary" href="#${esc(home.id)}">Go to ${esc(home.label)}</a></div>`;
    return;
  }
  const label = a.screens.find((s) => s.id === name).label;
  document.title = `${label} · EpiMetrics-Climate Simulator`;
  view.innerHTML = loadingHTML();
  try {
    const mod = await SCREENS[name]();
    if (my !== routeSeq) return;
    const off = await mod.render(view, { meta, screen: name, access: a });
    if (my === routeSeq) { cleanup = off; track("screen_open", { screen: name }); } else if (typeof off === "function") off();
  } catch (err) {
    if (my !== routeSeq) return;
    if (!["unauthorized", "session_changed", "account_disabled"].includes(err?.code)) console.error(err);
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

let lastAuthReason = null;
function boot() {
  initTheme();
  initAuth();
  initTilt();
  initTooltips();
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
    if (reason === "preview" || reason === "access") {
      clearApiCache();
      const home = access()?.home;
      if (home && !canOpen(requestedRoute())) { location.hash = home; return; }
      go();
      return;
    }
    resetData();
    if (reason === "timeout") toast("Signed out after 15 minutes without activity");
    if (reason === "expired") toast("Your session expired. Sign in again.");
    if (reason === "changed") toast("Your account was changed by an admin. Sign in again.");
    if (reason === "logout") toast("Signed out");
    if (reason === "login") { history.replaceState(null, "", location.pathname); }
    go();
  });
  go();
}

boot();

