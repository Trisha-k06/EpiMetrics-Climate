// Screen 6: what the project is built with, and the whole-project PDF export.
import { CONFIG } from "../config.js";
import { esc } from "../format.js";
import { TECH_GROUPS, PIPELINE } from "../tech.js";
import { toast } from "../ui.js";

const PDF_SECTIONS = [
  "What the project does, in plain language",
  "How it works, from settings to reports",
  "Data and study design",
  "Key terms: threshold, t0, TSR, ΔTSR, secondary wave",
  "The seven climate scenarios",
  "Worked example with a case chart",
  "Recovery delay for every scenario and district",
  "How reliable the estimates are",
  "Limitations",
  "Technology used",
];

export async function render(view, { meta }) {
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Screen 6 · Technology &amp; project summary</p>
        <h1>What the project is built with</h1>
        <p class="lede">Every part of EpiMetrics-Climate, from the Python recovery engine to the charts on this site, and what each one does. You can also download a summary of the whole project as a PDF.</p>
      </div>
    </div>

    <section class="panel export-panel">
      <div class="export-main">
        <h2>Project summary PDF</h2>
        <p>One document that explains the project from start to finish for readers who have not seen the app: the objective, the data, the method, the results across all districts, how reliable they are, the limitations and the technology. Figures come from the API, exactly as the screens show them.</p>
        <div class="row">
          <button class="btn btn-primary" type="button" id="pdf-export" ${CONFIG.ENABLE_FILE_DOWNLOADS ? "" : "disabled"}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Export PDF
          </button>
          <span class="small" id="pdf-status" role="status" aria-live="polite">${CONFIG.ENABLE_FILE_DOWNLOADS ? "A4, about 7 pages. Created on your computer; nothing is uploaded." : "PDF export is turned off in this hosted preview. Run the app locally to download the PDF."}</span>
        </div>
      </div>
      <div class="export-list">
        <p class="eyebrow" style="color:var(--ink-2)">What the PDF contains</p>
        <ol class="pdf-sections">${PDF_SECTIONS.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>How the pieces fit together</h2><span class="small">From settings to reports, left to right</span></div>
      <ol class="flow">${PIPELINE.map((p) => `<li><b>${esc(p.name)}</b><span>${esc(p.detail)}</span></li>`).join("")}</ol>
      <div class="grid cols-2" style="margin-top:16px">
        <div class="callout"><b>Backend (Python).</b> Creates the synthetic data and does every calculation: thresholds, Time to Sustained Recovery, recovery delay, secondary waves and validation.</div>
        <div class="callout"><b>Frontend (this website).</b> Asks the backend for results and displays them. It never calculates recovery itself, so the screens always match the Python results.</div>
      </div>
    </section>

    ${TECH_GROUPS.map((g) => `
      <section class="panel">
        <div class="panel-head"><h2>${esc(g.title)}</h2><span class="small">${esc(g.intro)}</span></div>
        <div class="tech-grid">
          ${g.items.map((it) => `<article class="tech-card tilt"><h3>${esc(it.name)}</h3><p>${esc(it.used)}</p><p class="tech-where"><span class="visually-hidden">Where in the project: </span>${esc(it.where)}</p></article>`).join("")}
        </div>
      </section>`).join("")}

    <p class="small">Dataset v${esc(meta.dataset_version)} · API v${esc(meta.api_version)} · ${CONFIG.API_MODE === "mock" ? "running on mock API files" : "connected to the live API"}</p>`;

  const btn = view.querySelector("#pdf-export");
  const status = view.querySelector("#pdf-status");
  btn?.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.innerHTML = "Creating PDF…";
    try {
      const { exportProjectPDF } = await import("../pdf.js");
      const pages = await exportProjectPDF(meta, (msg) => (status.textContent = msg));
      status.textContent = `Done. ${pages} pages saved to your Downloads folder.`;
      toast("PDF downloaded");
    } catch (err) {
      console.error(err);
      status.textContent = `The PDF could not be created: ${err.message} Check that the app is running from its folder (vendor/ must be present) and try again.`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  });
}
