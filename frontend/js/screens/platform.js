// Screen 7: who the platform is for, how it is delivered (SaaS) and how it is protected.
import { CONFIG } from "../config.js";
import { api } from "../api.js";
import { esc, fmtInt } from "../format.js";
import { END_USERS, ROLES, PERMISSIONS, SECURITY, SAAS } from "../platform-data.js";
import { currentSession, currentRole, can, logout, minutesLeft, onAuth, authRequired } from "../auth.js";
import { errorHTML, loadingHTML } from "../ui.js";

const yes = '<span class="perm yes" aria-label="Allowed">✓</span>';
const no = '<span class="perm no" aria-label="Not allowed">—</span>';

export async function render(view) {
  const s = currentSession();
  const role = s?.role;
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Screen 7 · Users, platform &amp; security</p>
        <h1>Who it serves, how it's delivered, how it's protected</h1>
        <p class="lede">The intended end users and what each would use the simulator for, how it runs as an online service (SaaS), and the security measures that protect accounts and data.</p>
      </div>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Who will use it</h2><span class="small">Each would use it to plan, not to diagnose or forecast real cases</span></div>
      <div class="user-grid">${END_USERS.map((u) => `<article class="user-card tilt"><h3>${esc(u.name)}</h3><p>${esc(u.task)}</p><a class="user-start" href="#${esc(u.start)}">Start with: ${esc(u.startLabel)} →</a></article>`).join("")}</div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Delivered as Software as a Service (SaaS)</h2><span class="pill pill-neutral">Proposed model</span></div>
      <p style="max-width:70ch">${esc(SAAS.summary)}</p>
      <ol class="flow flow-4" style="margin-top:14px">${SAAS.layers.map((l) => `<li><b>${esc(l.name)}</b><span>${esc(l.detail)}</span></li>`).join("")}</ol>
      <div class="grid cols-2" style="margin-top:16px">
        <div><h3 class="h3">Service tiers</h3><div class="table-wrap"><table><thead><tr><th>Tier</th><th>For</th><th>Includes</th><th>Price</th></tr></thead>
          <tbody>${SAAS.tiers.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${esc(t.who)}</td><td>${esc(t.includes)}</td><td>${esc(t.price)}</td></tr>`).join("")}</tbody></table></div></div>
        <div><h3 class="h3">How it runs</h3><ul class="plain small">${SAAS.delivery.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
          <p class="small" style="margin-top:8px">Now: website ${CONFIG.API_MODE === "mock" ? "running on mock API files" : `connected to ${esc(CONFIG.API_BASE)}`}.</p></div>
      </div>
    </section>

    <section class="grid cols-2">
      <div class="panel">
        <div class="panel-head"><h2>Your session</h2></div>
        ${authRequired() && s ? `<dl class="dl">
          <dt>Signed in as</dt><dd>${esc(s.display_name)} (<span class="mono">${esc(s.username)}</span>)</dd>
          <dt>Role</dt><dd><span class="pill pill-good">${esc(ROLES[role].label)}</span> ${esc(ROLES[role].summary)}</dd>
          <dt>Signed in</dt><dd>${new Date(s.signedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd>
          <dt>Automatic sign-out</dt><dd id="pf-left">after ${minutesLeft()} more minutes without activity</dd>
        </dl><button class="btn" type="button" id="pf-signout" style="margin-top:12px">Sign out</button>`
        : '<p class="small">Sign-in is turned off in this build (<span class="mono">CONFIG.AUTH.REQUIRED = false</span>).</p>'}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>What each role can do</h2></div>
        <div class="table-wrap"><table class="perm-table"><thead><tr><th>Action</th>${Object.entries(ROLES).map(([k, r]) => `<th class="n ${k === role ? "is-me" : ""}">${esc(r.label)}${k === role ? " (you)" : ""}</th>`).join("")}</tr></thead>
          <tbody>${PERMISSIONS.map((p) => `<tr><td>${esc(p.what)}</td>${Object.keys(ROLES).map((k) => `<td class="n ${k === role ? "is-me" : ""}">${p[k] ? yes : no}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Security measures</h2><span class="small">Protecting accounts, data, model and code</span></div>
      <div class="table-wrap"><table><thead><tr><th>Area</th><th>Measure</th><th>Status</th></tr></thead>
        <tbody>${SECURITY.map((m) => `<tr><td><b>${esc(m.area)}</b></td><td>${esc(m.measure)}</td><td>${m.status === "app" ? '<span class="pill pill-good">Working now</span>' : '<span class="pill pill-neutral">Backend, planned</span>'}</td></tr>`).join("")}</tbody></table></div>
    </section>

    <section class="panel" id="pf-integrity">
      <div class="panel-head"><h2>Data integrity</h2><span class="small">SHA-256 checksums prove the files have not been altered</span></div>
      <div id="pf-int-body">${loadingHTML("Loading the checksum manifest…")}</div>
    </section>`;

  view.querySelector("#pf-signout")?.addEventListener("click", () => logout("logout"));
  const off = onAuth((sess, why) => { if (why === "tick") { const el = view.querySelector("#pf-left"); if (el) el.textContent = `after ${minutesLeft()} more minutes without activity`; } });

  const body = view.querySelector("#pf-int-body");
  try {
    const m = await api.integrity();
    const files = m.files || [];
    const admin = can("integrity");
    body.innerHTML = `
      <p>The manifest lists <b>${fmtInt(files.length)}</b> app and API files and <b>${fmtInt((m.dataset_files || []).length)}</b> dataset tables, each with its ${esc(m.algorithm)} fingerprint (dataset v${esc(m.dataset_version)}, made ${esc(m.generated_at)}). If even one byte of a file changes, its fingerprint no longer matches.</p>
      <div class="row" style="margin-top:12px">
        ${admin ? '<button class="btn btn-primary" type="button" id="pf-verify">Verify files now</button>' : `<span class="pill pill-neutral">Admin only</span><span class="small">Sign in as an admin to re-check the files.</span>`}
        <span class="small" id="pf-int-status" role="status" aria-live="polite"></span>
      </div>
      <div id="pf-int-results" style="margin-top:12px"></div>
      <details class="data-table" style="margin-top:8px"><summary>Dataset table fingerprints (checked by the backend)</summary>
        <div class="table-wrap scroll-y" style="margin-top:8px"><table><thead><tr><th>Dataset file</th><th class="n">Size</th><th>SHA-256</th></tr></thead>
        <tbody>${(m.dataset_files || []).map((f) => `<tr><td class="mono">${esc(f.path)}</td><td class="n">${fmtInt(f.bytes)} B</td><td class="mono small">${esc(f.sha256.slice(0, 16))}…</td></tr>`).join("") || '<tr><td colspan="3">Not included in this manifest.</td></tr>'}</tbody></table></div>
        <p class="small" style="margin-top:6px">${esc(m.note || "")}</p></details>`;
    body.querySelector("#pf-verify")?.addEventListener("click", () => verify(files, body));
  } catch (err) {
    body.innerHTML = errorHTML(err);
  }
  return off;
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verify(files, body) {
  const btn = body.querySelector("#pf-verify"), status = body.querySelector("#pf-int-status"), out = body.querySelector("#pf-int-results");
  btn.disabled = true;
  const rows = [];
  let ok = 0, bad = 0, miss = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    status.textContent = `Checking ${i + 1} of ${files.length}…`;
    let state = "miss";
    try {
      const res = await fetch(f.url, { cache: "no-store" });
      if (res.ok) state = (await sha256Hex(await res.arrayBuffer())) === f.sha256 ? "ok" : "bad";
    } catch { state = "miss"; }
    if (state === "ok") ok++; else if (state === "bad") bad++; else miss++;
    rows.push({ f, state });
  }
  btn.disabled = false;
  status.innerHTML = bad || miss
    ? `<span class="pill pill-crit">${bad} changed, ${miss} unreachable</span> ${ok} of ${files.length} match`
    : `<span class="pill pill-good">All ${ok} files match</span> checked ${new Date().toLocaleTimeString()}`;
  const order = { bad: 0, miss: 1, ok: 2 };
  rows.sort((a, b) => order[a.state] - order[b.state]);
  out.innerHTML = `<div class="table-wrap scroll-y"><table><thead><tr><th>File</th><th class="n">Size</th><th>Result</th></tr></thead><tbody>${rows.map(({ f, state }) => `<tr><td class="mono small">${esc(f.url)}</td><td class="n">${fmtInt(f.bytes)} B</td><td>${state === "ok" ? '<span class="pill pill-good">✓ matches</span>' : state === "bad" ? '<span class="pill pill-crit">✗ changed</span>' : '<span class="pill pill-warn">unreachable</span>'}</td></tr>`).join("")}</tbody></table></div>`;
}
