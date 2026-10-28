// Day / Night mode. Follows the system setting until the user picks one; the choice is remembered.
const KEY = "epimetrics.theme";
const root = document.documentElement;

export function currentTheme() {
  const set = root.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function sync() {
  const t = currentTheme();
  document.querySelectorAll("[data-theme-choice]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeChoice === t)));
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: t } }));
}

export function setTheme(t) {
  root.setAttribute("data-theme", t);
  try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
  sync();
}

export function initTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch { /* ignore */ }
  document.querySelectorAll("[data-theme-choice]").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeChoice)));
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (!root.hasAttribute("data-theme")) sync(); });
  sync();
}

// Read a CSS colour token as a hex/rgb string (used by the 3D map).
export function token(name) {
  return getComputedStyle(root).getPropertyValue(name).trim();
}
