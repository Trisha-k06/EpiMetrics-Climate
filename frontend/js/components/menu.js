// A single menu button (e.g. "Export report ▾") that replaces a row of secondary buttons.
// Keyboard: Enter/Space/ArrowDown opens, arrows move, Escape closes and returns focus.
import { esc } from "../format.js";

/** items: [{ id, label, hint, disabled }] · options: an optional HTML block shown above the items (e.g. a checkbox). */
export function menuHTML({ id, label, items, options = "", primary = true, icon = "" }) {
  return `<div class="menu" data-menu="${esc(id)}">
    <button type="button" class="btn ${primary ? "btn-primary" : ""} menu-btn" id="${esc(id)}" aria-haspopup="menu" aria-expanded="false" aria-controls="${esc(id)}-list">${icon}${esc(label)} <span aria-hidden="true">▾</span></button>
    <div class="menu-list" id="${esc(id)}-list" role="menu" aria-labelledby="${esc(id)}" hidden>
      ${options ? `<div class="menu-options">${options}</div>` : ""}
      ${items.map((it) => `<button type="button" role="menuitem" class="menu-item" data-item="${esc(it.id)}" ${it.disabled ? 'aria-disabled="true"' : ""}>
        <span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ""}</button>`).join("")}
    </div></div>`;
}

export function bindMenu(root, id, onSelect) {
  const wrap = root.querySelector(`[data-menu="${CSS.escape(id)}"]`);
  if (!wrap) return () => {};
  const btn = wrap.querySelector(".menu-btn"), list = wrap.querySelector(".menu-list");
  const items = () => [...list.querySelectorAll(".menu-item:not([aria-disabled='true'])")];
  const open = (focusFirst) => {
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    if (focusFirst) items()[0]?.focus();
  };
  const close = (focusBtn) => {
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (focusBtn) btn.focus();
  };
  btn.addEventListener("click", () => (list.hidden ? open(false) : close(false)));
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); open(true); } });
  list.addEventListener("keydown", (e) => {
    const all = items(), i = all.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    if (e.key === "ArrowDown") { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
  });
  list.addEventListener("click", (e) => {
    const it = e.target.closest(".menu-item");
    if (!it || it.getAttribute("aria-disabled") === "true") return;
    close(true);
    onSelect(it.dataset.item, wrap);
  });
  // Removes itself once the menu has left the page (screen change), so listeners never pile up.
  const outside = (e) => {
    if (!wrap.isConnected) { document.removeEventListener("click", outside); return; }
    if (!wrap.contains(e.target)) close(false);
  };
  document.addEventListener("click", outside);
  return () => document.removeEventListener("click", outside);
}
