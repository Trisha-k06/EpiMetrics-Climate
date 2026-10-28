// Screen 9: what the project is built with, and the whole-project PDF export.
import { CONFIG } from "../config.js";
import { esc } from "../format.js";
import { TECH_GROUPS, PIPELINE } from "../tech.js";
import { toast } from "../ui.js";
import { can } from "../auth.js";
import { api } from "../api.js";

const PDF_SECTIONS = [
  "What the project does, in plain language",
  "How it works, from settings to reports",
  "Data and study design",
  "Data audit (notebook 01 checks)",
  "Key terms: threshold, t0, TSR, ΔTSR, secondary wave",
  "The seven climate scenarios",
  "Worked example with a case chart",
  "Recovery delay for every scenario and district",
  "Outbreak episodes 2015–2024 (notebooks 06–07)",
  "Forecast models as benchmarks (notebooks 03–05)",
  "How reliable the estimates are",
  "Limitations",
  "Who will use it",
  "Delivery as a service (SaaS) and security",
  "The assistant",
  "Technology used",
];

let lastPages = 0;

export async function render(view, { meta }) {
  const allow = CONFIG.ENABLE_FILE_DOWNLOADS && can("exports");
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Screen 9 · Technology &amp; project summary</p>
        <h1>What the project is built with</h1>
        <p class="lede">Every part of EpiMetrics-Climate, from the Python recovery engine to the charts on this site, and what each one does. You can also download a summary of the whole project as a PDF.</p>
      </div>
    </div>

    <section class="panel export-panel">
      <div class="export-main">
        <h2>Project summary PDF</h2>
        <p>One document that explains the project from start to finish for readers who have not seen the app: the objective, the data, the method, the results across all districts, how reliable they are, the limitations and the technology. Figures come from the API, exactly as the screens show them.</p>
        <div class="row">
          <button class="btn btn-primary" type="button" id="pdf-export" ${allow ? "" : "disabled"}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Export PDF
          </button>
          <span class="small" id="pdf-status" role="status" aria-live="polite">${!can("exports") ? "Exporting needs an Analyst or Admin account." : CONFIG.ENABLE_FILE_DOWNLOADS ? (lastPages ? `A4. The last export had ${lastPages} pages. Created on your computer from API results; the server logs the export.` : "A4. Created on your computer from API results; the server logs the export.") : "PDF export is turned off in this hosted preview. Run the app locally to download the PDF."}</span>
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
        <div class="callout"><b>Backend (Python, FastAPI).</b> <span class="mono">python -m backend</span> serves this website and the API on one address. It loads the synthetic dataset, runs the recovery engine and the notebook analyses (statsmodels, scikit-learn), and checks every sign-in and export.</div>
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

    <p class="small">Dataset v${esc(meta.dataset_version)} · API v${esc(meta.api_version)} · connected to the FastAPI backend at <span class="mono">${esc(CONFIG.API_BASE)}</span></p>`;

  const btn = view.querySelector("#pdf-export");
  const status = view.querySelector("#pdf-status");
  btn?.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.innerHTML = "Creating PDF…";
    try {
      status.textContent = "Checking with the server…";
      try {
        await api.logExport("project_pdf");
      } catch (err) {
        status.textContent = err.status === 403 ? "The server refused this export: your account is not allowed to export." : `The export was not started: ${err.message}`;
        return;
      }
      const { exportProjectPDF } = await import("../pdf.js");
      const pages = await exportProjectPDF(meta, (msg) => (status.textContent = msg));
      lastPages = pages;
      status.textContent = `Done. The PDF has ${pages} pages and is in your Downloads folder.`;
      toast("PDF downloaded");
    } catch (err) {
      console.error(err);
      status.textContent = `The PDF could not be created: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  });
}
