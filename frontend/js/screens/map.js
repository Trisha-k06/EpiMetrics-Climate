// District map for viewers: the map first, then a district panel that drills down district › disease › year › month.
import { api } from "../api.js";
import { getSelection, setSelection, onSelection } from "../state.js";
import { esc } from "../format.js";
import { scenarioSelectHTML, bindSelects, errorHTML, screenEyebrow } from "../ui.js";
import { createDistrictMap, mapValuesFromCells, mapValuesFromProfiles, districtTip } from "../map3d.js";
import { mountDrill } from "../components/drill.js";
import { mountPin } from "../components/saved.js";
import { infoTip } from "../components/tooltip.js";

const LAYERS = [{ id: "result", label: "Recovery delay" }, { id: "peak", label: "Outbreak size" }];

export async function render(view, { meta }) {
  let layer = "result";
  let matrix = null, profiles = [];
  const sel = getSelection();
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${screenEyebrow("map", "District map")}</p>
        <h1>Where does recovery take longest?</h1>
        <p class="lede">Each study district is coloured by the extra months a climate scenario adds to recovery ${infoTip("delta_tsr")}. Select a district to open its panel.</p>
      </div>
    </div>
    <section class="panel stack">
      <div class="controls">
        <div class="field"><label for="mp-disease">Disease</label><select id="mp-disease" data-key="disease">${meta.diseases.map((d) => `<option value="${esc(d.id)}" ${d.id === sel.disease ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
        ${scenarioSelectHTML(meta, sel, "mp")}
        <div class="field"><span class="label" id="mp-layer-label">Colour by</span>
          <div class="seg" role="group" aria-labelledby="mp-layer-label">${LAYERS.map((l) => `<button type="button" data-layer="${l.id}" aria-pressed="${l.id === layer}">${esc(l.label)}</button>`).join("")}</div></div>
      </div>
      <div id="mp-map"></div>
    </section>
    <section class="panel" id="mp-panel" aria-live="polite"><div id="mp-drill"></div><div id="mp-pin" style="margin-top:10px"></div></section>`;
  bindSelects(view);

  const drill = mountDrill(view.querySelector("#mp-drill"), meta, { initialDistrict: sel.district, onTop: () => view.querySelector("#mp-map").scrollIntoView({ block: "start" }) });
  mountPin(view.querySelector("#mp-pin"), sel.district, meta);
  const tipFor = (id) => districtTip(profiles.find((d) => d.id === id));
  const choose = (id) => { setSelection({ district: id }); drill.show(id); mountPin(view.querySelector("#mp-pin"), id, meta); };
  let map = null;
  const mapReady = createDistrictMap(view.querySelector("#mp-map"), meta.districts, { onSelect: choose, tipFor })
    .then((m) => { map = m; paint(); return m; })
    .catch((err) => { view.querySelector("#mp-map").innerHTML = errorHTML(err); return null; });

  function paint() {
    if (!map || !matrix) return;
    const s = getSelection();
    const mv = layer === "result" || !profiles.length ? mapValuesFromCells(matrix.cells, s.scenario, "delta") : mapValuesFromProfiles(profiles, "peak", s.disease);
    map.update(mv.values, s.district, mv.legend);
  }
  view.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", () => {
    layer = b.dataset.layer;
    view.querySelectorAll("[data-layer]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    paint();
  }));

  let lastDisease = null;
  async function update() {
    const s = getSelection();
    view.querySelectorAll("select[data-key]").forEach((el) => (el.value = s[el.dataset.key]));
    try {
      if (s.disease !== lastDisease || !matrix) { matrix = await api.recoveryMatrix({ disease: s.disease }); lastDisease = s.disease; }
      if (!profiles.length) profiles = (await api.districts()).districts;
      paint();
      drill.refresh();
    } catch (err) {
      view.querySelector("#mp-drill").innerHTML = errorHTML(err);
    }
  }
  const off = onSelection(update);
  await update();
  return () => { off(); mapReady.then((m) => m?.dispose()); };
}

