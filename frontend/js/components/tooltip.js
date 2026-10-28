// Plain-language "i" tooltips. infoTip("tsr") returns a small button; one shared popover shows the glossary sentence.
// Works with mouse hover, click, tap and keyboard (Enter/Space toggles, Escape closes).
import { GLOSSARY } from "../glossary.js";
import { esc } from "../format.js";

export function infoTip(id, { label } = {}) {
  const g = GLOSSARY[id];
  if (!g) return "";
  return `<button type="button" class="info-tip" data-tip="${esc(id)}" aria-label="What is ${esc(label || g.term)}?" aria-expanded="false">i</button>`;
}

let pop = null;
let owner = null;
let pinned = false;

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement("div");
  pop.id = "tip-pop";
  pop.className = "tip-pop";
  pop.setAttribute("role", "tooltip");
  pop.hidden = true;
  document.body.appendChild(pop);
  return pop;
}

function show(btn, pin) {
  const g = GLOSSARY[btn.dataset.tip];
  if (!g) return;
  const p = ensurePop();
  if (owner && owner !== btn) owner.setAttribute("aria-expanded", "false");
  owner = btn;
  pinned = pin;
  p.innerHTML = `<b>${esc(g.term)}</b><span>${esc(btn.dataset.kid ? g.kid : g.plain)}</span>`;
  p.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  btn.setAttribute("aria-describedby", "tip-pop");
  const r = btn.getBoundingClientRect();
  const w = Math.min(300, window.innerWidth - 24);
  p.style.width = `${w}px`;
  const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12));
  const below = r.bottom + 8 + p.offsetHeight < window.innerHeight;
  p.style.left = `${left + window.scrollX}px`;
  p.style.top = `${(below ? r.bottom + 8 : r.top - p.offsetHeight - 8) + window.scrollY}px`;
}

function hide() {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pinned = false;
  if (owner) { owner.setAttribute("aria-expanded", "false"); owner.removeAttribute("aria-describedby"); }
  owner = null;
}

export function initTooltips() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".info-tip");
    if (btn) {
      e.preventDefault();
      if (owner === btn && pinned) hide(); else show(btn, true);
      return;
    }
    if (!e.target.closest?.("#tip-pop")) hide();
  });
  document.addEventListener("pointerover", (e) => {
    const btn = e.target.closest?.(".info-tip");
    if (btn && e.pointerType === "mouse" && !pinned) show(btn, false);
  });
  document.addEventListener("pointerout", (e) => {
    const btn = e.target.closest?.(".info-tip");
    if (btn && e.pointerType === "mouse" && !pinned && owner === btn) hide();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("hashchange", hide);
  window.addEventListener("scroll", () => { if (!pinned) hide(); }, { passive: true });
}
