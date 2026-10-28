// Who the platform is for, how it is delivered (SaaS) and how it is protected. The role table is built from the
// server's role matrix (/auth/me), never from a list in this file.
import { CONFIG } from "../config.js";
import { api } from "../api.js";
import { esc, fmtInt } from "../format.js";
import { END_USERS, PERM_TEXT, SECURITY, SAAS } from "../platform-data.js";
import { currentSession, access, roleMatrix, can, logout, minutesLeft, onAuth } from "../auth.js";
import { errorHTML, loadingHTML } from "../ui.js";

const yes = '<span class="perm yes" aria-label="Allowed">✓</span>';
const no = '<span class="perm no" aria-label="Not allowed">—</span>';

export async function render(view) {
  const s = currentSession();
  const a = access();
  const roles = roleMatrix();
  const n = a.screens.findIndex((x) => x.id === "platform") + 1;
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Screen ${n} · Users, platform &amp; security</p>
        <h1>Who it serves, how it's delivered, how it's protected</h1>
        <p class="lede">Each audience gets its own experience, the service runs from one hosted copy, and the server enforces every access rule.</p>
      </div>
      ${can("admin") ? '<a class="btn btn-primary" href="#admin">Open the Admin console</a>' : ""}
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Who will use it</h2><span class="small">For planning and learning, not to diagnose or forecast real cases</span></div>
      <div class="user-grid">${END_USERS.map((u) => `<article class="user-card tilt"><h3>${esc(u.name)}</h3><p>${esc(u.task)}</p></article>`).join("")}</div>
    </section>

    <section class="grid cols-2">
      <div class="panel">
        <div class="panel-head"><h2>Your session</h2></div>
        <dl class="dl">
          <dt>Signed in as</dt><dd>${esc(s.display_name)} (<span class="mono">${esc(s.username)}</span>)</dd>
          <dt>Experience</dt><dd><span class="pill pill-good">${esc(a.label)}</span> ${esc(a.summary)}</dd>
          <dt>Signed in</dt><dd>${new Date(s.signedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd>
          <dt>Automatic sign-out</dt><dd id="pf-left">after ${minutesLeft()} more minutes without activity</dd>
          <dt>Server session</dt><dd>Signed token, renewed while you work; sign-out revokes it</dd>
        </dl>
        <button class="btn" type="button" id="pf-signout" style="margin-top:12px">Sign out</button>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>What each role can do</h2><span class="small">From the server's role matrix</span></div>
        <div class="table-wrap"><table class="perm-table"><thead><tr><th>Action</th>${roles.map((r) => `<th class="n ${r.role === a.role ? "is-me" : ""}">${esc(r.label)}${r.role === a.role ? " (you)" : ""}</th>`).join("")}</tr></thead>
          <tbody>${PERM_TEXT.map((p) => `<tr><td>${esc(p.what)}</td>${roles.map((r) => `<td class="n ${r.role === a.role ? "is-me" : ""}">${r.permissions.includes(p.perm) ? yes : no}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      </div>
    </section>

    <details class="panel learn-more">
      <summary><h2>Delivered as Software as a Service (SaaS)</h2><span class="small">How the service is hosted and offered</span></summary>
      <p style="max-width:70ch;margin-top:10px">${esc(SAAS.summary)}</p>
      <ol class="flow flow-4" style="margin-top:14px">${SAAS.layers.map((l) => `<li><b>${esc(l.name)}</b><span>${esc(l.detail)}</span></li>`).join("")}</ol>
      <div class="grid cols-2" style="margin-top:16px">
        <div><h3 class="h3">Service tiers</h3><div class="table-wrap"><table><thead><tr><th>Tier</th><th>For</th><th>Includes</th><th>Price</th></tr></thead>
          <tbody>${SAAS.tiers.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${esc(t.who)}</td><td>${esc(t.includes)}</td><td>${esc(t.price)}</td></tr>`).join("")}</tbody></table></div></div>
        <div><h3 class="h3">How it runs</h3><ul class="plain small">${SAAS.delivery.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
          <p class="small" style="margin-top:8px">Now: this website is served by the FastAPI backend on the same address as <span class="mono">${esc(CONFIG.API_BASE)}</span>.</p></div>
      </div>
    </details>

    <section class="panel">
      <div class="panel-head"><h2>Security measures</h2><span class="small">Protecting accounts, data, model and code</span></div>
      <div class="table-wrap"><table><thead><tr><th>Area</th><th>Measure</th><th>Status</th></tr></thead>
        <tbody>${SECURITY.map((m) => `<tr><td><b>${esc(m.area)}</b></td><td>${esc(m.measure)}</td><td>${m.status === "app" ? '<span class="pill pill-good">Working now</span>' : '<span class="pill pill-neutral">At deployment</span>'}</td></tr>`).join("")}</tbody></table></div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Data integrity</h2><span class="small">SHA-256 fingerprints prove the files have not been altered</span></div>
      <div id="pf-int-body">${loadingHTML("Loading the checksum manifest…")}</div>
    </section>`;

  view.querySelector("#pf-signout").addEventListener("click", () => logout("logout"));
  const off = onAuth((sess, why) => { if (why === "tick") { const el = view.querySelector("#pf-left"); if (el) el.textContent = `after ${minutesLeft()} more minutes without activity`; } });

  const body = view.querySelector("#pf-int-body");
  try {
    const m = await api.integrity();
    const counts = m.scope === "full" ? m.files.reduce((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] || 0) + 1 }), {}) : m.counts || {};
    const total = m.scope === "full" ? m.files.length : m.total_files || 0;
    body.innerHTML = m.available === false ? '<div class="state">The server has no checksum manifest yet. An admin can create it with <span class="mono">python -m backend.manage manifest</span>.</div>'
      : `<p>The manifest lists <b>${fmtInt(total)}</b> files with their ${esc(m.algorithm)} fingerprints: ${Object.entries(counts).map(([k, v]) => `${fmtInt(v)} ${esc(k)}`).join(", ")} (dataset v${esc(m.dataset_version)}, made ${esc(m.generated_at)}). If even one byte changes, the fingerprint no longer matches.</p>
        <p class="small" style="margin-top:8px">${can("integrity.admin") ? 'Re-check the files and run the validation scripts in the <a href="#admin">Admin console</a>.' : "Admins can re-check every file on the server and in the browser."}</p>`;
  } catch (err) {
    body.innerHTML = errorHTML(err);
  }
  return off;
}
