// Breadcrumbs for drill-downs: "Tamil Nadu › Coimbatore › Dengue › 2023". Every crumb but the last is a button.
import { esc } from "../format.js";

export function crumbsHTML(crumbs) {
  return `<nav class="crumbs" aria-label="Where you are"><ol>${crumbs.map((c, i) => i < crumbs.length - 1
    ? `<li><button type="button" data-crumb="${i}">${esc(c.label)}</button></li>`
    : `<li aria-current="location">${esc(c.label)}</li>`).join("")}</ol></nav>`;
}

export function bindCrumbs(root, crumbs) {
  root.querySelectorAll("[data-crumb]").forEach((b) => b.addEventListener("click", () => crumbs[Number(b.dataset.crumb)]?.onClick?.()));
}
