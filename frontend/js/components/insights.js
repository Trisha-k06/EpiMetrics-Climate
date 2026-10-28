// Recommended insights: at most 3, from the server (co-views by ≥3 people, or rules over API results). Never for Young Minds.
import { api } from "../api.js";
import { can } from "../auth.js";
import { esc } from "../format.js";
import { setSelection } from "../state.js";

export async function mountInsights(host, sel) {
  if (!can("insights")) { host.hidden = true; return; }
  host.classList.add("insights");
  host.innerHTML = '<p class="small">Looking for related results…</p>';
  try {
    const r = await api.insights(sel);
    if (!r.insights.length) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = `<div class="panel-head"><h2>You might also look at</h2></div>
      <ul class="insight-list">${r.insights.map((i, k) => `<li><span class="insight-kind">${i.kind === "coview" ? "Explored together" : "From the results"}</span>
        <span>${esc(i.text)}</span><button type="button" class="btn btn-sm" data-k="${k}">Open</button></li>`).join("")}</ul>
      <p class="small">${esc(r.note)}</p>`;
    host.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => {
      const l = r.insights[Number(b.dataset.k)].link;
      setSelection(Object.fromEntries(Object.entries({ district: l.district, disease: l.disease, scenario: l.scenario }).filter(([, v]) => v)));
      location.hash = l.screen;
    }));
  } catch (err) {
    host.innerHTML = `<p class="small">Suggestions are not available right now (${esc(err.message)}).</p>`;
  }
}
