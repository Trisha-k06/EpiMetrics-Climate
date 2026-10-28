// "☆ Save this view", "Pin district" and the "My saved" panel. Stored on the server per user (/me/saved, /me/favorites);
// localStorage is never the store.
import { api } from "../api.js";
import { can } from "../auth.js";
import { esc, byId } from "../format.js";
import { setSelection } from "../state.js";
import { errorHTML, toast } from "../ui.js";

/** A save button that opens a small inline form for the view's name. getView() → the view to store. */
export function mountSaveView(host, getView, meta) {
  if (!can("saved", { write: true })) { host.hidden = true; return; }
  host.classList.add("save-view");
  host.innerHTML = `<button type="button" class="btn" data-open aria-expanded="false"><span aria-hidden="true">☆</span> Save this view</button>
    <form class="save-form" hidden novalidate><label class="visually-hidden" for="sv-name">Name for this view</label>
      <input id="sv-name" maxlength="80" autocomplete="off"><button class="btn btn-primary" type="submit">Save</button><button class="btn" type="button" data-cancel>Cancel</button></form>`;
  const open = host.querySelector("[data-open]"), form = host.querySelector("form"), input = form.querySelector("input");
  open.addEventListener("click", () => {
    const v = getView();
    const scen = byId(meta.scenarios, v.scenario)?.label, dist = byId(meta.districts, v.district)?.name, dis = byId(meta.diseases, v.disease)?.name;
    input.value = v.scenario_b ? `${dist} ${dis}: ${scen} vs ${byId(meta.scenarios, v.scenario_b)?.label}` : `${dist} ${dis}: ${scen}`;
    form.hidden = false;
    open.hidden = true;
    input.focus();
    input.select();
  });
  const close = () => { form.hidden = true; open.hidden = false; open.focus(); };
  form.querySelector("[data-cancel]").addEventListener("click", close);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.saveView({ ...getView(), name: input.value });
      toast("View saved. Find it under My saved on the home screen.");
      close();
    } catch (err) { toast(err.message); }
  });
}

/** Toggle button to pin/unpin a favourite district. */
export function mountPin(host, district, meta) {
  if (!can("saved", { write: true })) { host.hidden = true; return; }
  let favs = [];
  const draw = () => {
    const on = favs.includes(district);
    const name = byId(meta.districts, district)?.name || district;
    host.innerHTML = `<button type="button" class="btn btn-sm pin-btn" aria-pressed="${on}"><span aria-hidden="true">${on ? "📌" : "📍"}</span> ${on ? `Pinned ${esc(name)}` : `Pin ${esc(name)}`}</button>`;
    host.querySelector("button").addEventListener("click", async () => {
      try { favs = (on ? await api.removeFavorite(district) : await api.addFavorite(district)).favorites; draw(); } catch (err) { toast(err.message); }
    });
  };
  api.favorites().then((r) => { favs = r.favorites; draw(); }).catch((err) => { host.innerHTML = errorHTML(err); });
}

/** The "My saved" panel: saved views and pinned districts, one click to return. */
export async function mountSavedPanel(host, meta) {
  if (!can("saved")) { host.hidden = true; return; }
  const readOnly = !can("saved", { write: true });
  host.innerHTML = '<p class="small">Loading your saved views…</p>';
  const load = async () => {
    try {
      const [s, f] = await Promise.all([api.saved(), api.favorites()]);
      const views = s.saved, favs = f.favorites;
      host.innerHTML = `
        ${favs.length ? `<div class="chip-row" aria-label="Pinned districts">${favs.map((d) => `<button type="button" class="chip" data-fav="${esc(d)}">📌 ${esc(byId(meta.districts, d)?.name || d)}</button>`).join("")}</div>` : ""}
        ${views.length ? `<ul class="saved-list">${views.map((v) => `<li><button type="button" class="saved-open" data-id="${v.id}"><b></b><span class="small">${esc(labelFor(v, meta))}</span></button>
          ${readOnly ? "" : `<button type="button" class="btn btn-sm saved-del" data-del="${v.id}" aria-label="Delete saved view">✕</button>`}</li>`).join("")}</ul>`
          : `<p class="small">Nothing saved yet. Use <b>☆ Save this view</b> on the simulator, compare or report screens, and <b>Pin</b> a district to keep it here.</p>`}`;
      host.querySelectorAll(".saved-open").forEach((b) => { b.querySelector("b").textContent = views.find((v) => String(v.id) === b.dataset.id).name; });
      host.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => openSaved(views.find((v) => String(v.id) === b.dataset.id))));
      host.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
        try { await api.deleteSaved(b.dataset.del); load(); } catch (err) { toast(err.message); }
      }));
      host.querySelectorAll("[data-fav]").forEach((b) => b.addEventListener("click", () => { setSelection({ district: b.dataset.fav }); location.hash = "simulator"; }));
    } catch (err) { host.innerHTML = errorHTML(err); }
  };
  await load();
}

function labelFor(v, meta) {
  const s = (id) => byId(meta.scenarios, id)?.label || id;
  const parts = [byId(meta.districts, v.district)?.name, byId(meta.diseases, v.disease)?.name, v.scenario_b ? `${s(v.scenario)} vs ${s(v.scenario_b)}` : s(v.scenario)];
  if (v.district_b) parts.push(`vs ${byId(meta.districts, v.district_b)?.name}`);
  if (v.mask && v.mask !== "none") parts.push(byId(meta.masks, v.mask)?.label);
  return `${parts.filter(Boolean).join(" · ")} · ${v.screen}`;
}

export function openSaved(v) {
  setSelection({ district: v.district, disease: v.disease, scenario: v.scenario, mask: v.mask || "none",
    compareB: v.scenario_b || null, compareDistrict: v.district_b || null });
  location.hash = v.screen;
}
