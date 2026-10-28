// Shared selection (district, disease, scenario, reporting-completeness mask) across screens.
import { CONFIG } from "./config.js";

const KEY = "epimetrics.selection.v1";
const listeners = new Set();
let selection = { ...CONFIG.DEFAULT_SELECTION };

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (saved && typeof saved === "object") selection = { ...selection, ...saved };
} catch { /* storage unavailable: keep defaults */ }

export function getSelection() { return { ...selection }; }

export function setSelection(patch) {
  const next = { ...selection, ...patch };
  if (JSON.stringify(next) === JSON.stringify(selection)) return;
  selection = next;
  try { localStorage.setItem(KEY, JSON.stringify(selection)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(getSelection()));
}

export function onSelection(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Drop saved ids that the API no longer offers.
export function reconcileSelection(meta) {
  const ok = (list, id) => list.some((x) => x.id === id);
  const d = CONFIG.DEFAULT_SELECTION;
  setSelection({
    district: ok(meta.districts, selection.district) ? selection.district : d.district,
    disease: ok(meta.diseases, selection.disease) ? selection.disease : d.disease,
    scenario: ok(meta.scenarios, selection.scenario) ? selection.scenario : d.scenario,
    mask: ok(meta.masks, selection.mask) ? selection.mask : d.mask,
  });
}
