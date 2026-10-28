// Screen 10: who the platform is for, how it is delivered (SaaS) and how it is protected.
import { CONFIG } from "../config.js";
import { api } from "../api.js";
import { esc, fmtInt } from "../format.js";
import { END_USERS, ROLES, PERMISSIONS, SECURITY, SAAS } from "../platform-data.js";
import { currentSession, can, logout, minutesLeft, onAuth } from "../auth.js";
import { errorHTML, loadingHTML, passPill } from "../ui.js";

const yes = '<span class="perm yes" aria-label="Allowed">✓</span>';
const no = '<span class="perm no" aria-label="Not allowed">—</span>';

export async function render(view) {
  const s = currentSession();
  const role = s?.role;
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Screen 10 · Users, platform &amp; security</p>
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
          <p class="small" style="margin-top:8px">Now: this website is served by the FastAPI backend and connected to <span class="mono">${esc(CONFIG.API_BASE)}</span> on the same address.</p></div>
      </div>
    </section>

    <section class="grid cols-2">
      <div class="panel">
        <div class="panel-head"><h2>Your session</h2></div>
        ${s ? `<dl class="dl">
          <dt>Signed in as</dt><dd>${esc(s.display_name)} (<span class="mono">${esc(s.username)}</span>)</dd>
          <dt>Role</dt><dd><span class="pill pill-good">${esc(ROLES[role].label)}</span> ${esc(ROLES[role].summary)}</dd>
          <dt>Signed in</dt><dd>${new Date(s.signedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd>
          <dt>Automatic sign-out</dt><dd id="pf-left">after ${minutesLeft()} more minutes without activity</dd>
          <dt>Server session</dt><dd>Signed token, renewed by the server while you work; sign-out revokes it</dd>
        </dl><button class="btn" type="button" id="pf-signout" style="margin-top:12px">Sign out</button>`
        : ""}
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
        <tbody>${SECURITY.map((m) => `<tr><td><b>${esc(m.area)}</b></td><td>${esc(m.measure)}</td><td>${m.status === "app" ? '<span class="pill pill-good">Working now</span>' : '<span class="pill pill-neutral">At deployment</span>'}</td></tr>`).join("")}</tbody></table></div>
    </section>

    <section class="panel" id="pf-integrity">
      <div class="panel-head"><h2>Data integrity</h2><span class="small">SHA-256 checksums prove the files have not been altered</span></div>
      <div id="pf-int-body">${loadingHTML("Loading the checksum manifest…")}</div>
    </section>
    ${can("integrity") ? `<section class="panel" id="pf-audit"><div class="panel-head"><h2>Audit log</h2><span class="small">Newest first · sign-ins, scenario runs, exports, refused requests, integrity checks</span></div>
      <div class="row" style="margin-bottom:10px"><button class="btn btn-sm" type="button" id="pf-audit-refresh">Refresh</button></div><div id="pf-audit-body">${loadingHTML()}</div></section>` : ""}`;

  view.querySelector("#pf-signout")?.addEventListener("click", () => logout("logout"));
  const off = onAuth((sess, why) => { if (why === "tick") { const el = view.querySelector("#pf-left"); if (el) el.textContent = `after ${minutesLeft()} more minutes without activity`; } });

  const body = view.querySelector("#pf-int-body");
  try {
    const m = await api.integrity();
    const admin = can("integrity") && m.scope === "full";
    const counts = admin ? m.files.reduce((a, f) => ({ ...a, [f.kind]: (a[f.kind] || 0) + 1 }), {}) : m.counts || {};
    const total = admin ? m.files.length : m.total_files || 0;
    body.innerHTML = m.available === false ? '<div class="state">The server has no checksum manifest yet. An admin can create it with <span class="mono">python -m backend.manage manifest</span>.</div>' : `
      <p>The manifest lists <b>${fmtInt(total)}</b> files with their ${esc(m.algorithm)} fingerprints: ${Object.entries(counts).map(([k, n]) => `${fmtInt(n)} ${esc(k)}`).join(", ")} (dataset v${esc(m.dataset_version)}, made ${esc(m.generated_at)}). If even one byte of a file changes, its fingerprint no longer matches.</p>
      ${admin ? `<div class="admin-actions" style="margin-top:12px">
          <button class="btn btn-primary" type="button" id="pf-verify-server">Verify files on the server</button>
          <button class="btn" type="button" id="pf-validate">Run validation scripts</button>
          <button class="btn" type="button" id="pf-verify-browser">Re-check website files in this browser</button>
        </div>
        <p class="small" id="pf-int-status" role="status" aria-live="polite" style="margin-top:8px"></p>
        <div id="pf-int-results" style="margin-top:12px"></div>`
      : '<div class="row" style="margin-top:12px"><span class="pill pill-neutral">Admin only</span><span class="small">Sign in as an admin to re-check the files, run the validation scripts and read the audit log.</span></div>'}`;
    if (admin) bindAdmin(body, m);
  } catch (err) {
    body.innerHTML = errorHTML(err);
  }
  if (can("integrity")) {
    const load = async () => {
      const host = view.querySelector("#pf-audit-body");
      if (!host) return;
      try {
        const log = await api.auditLog();
        host.innerHTML = log.entries.length ? `<div class="table-wrap scroll-y"><table class="audit-table"><thead><tr><th>Time (UTC)</th><th>Action</th><th>User</th><th>Role</th><th>Result</th><th>Detail</th></tr></thead><tbody>
          ${log.entries.map((e) => `<tr><td class="mono small">${esc(e.ts)}</td><td>${esc(e.action)}</td><td class="mono">${esc(e.user || "—")}</td><td>${esc(e.role || "—")}</td><td>${e.status === "ok" ? '<span class="pill pill-good">ok</span>' : `<span class="pill pill-warn">${esc(e.status)}</span>`}</td><td class="detail small">${esc(typeof e.detail === "object" && e.detail ? Object.entries(e.detail).map(([k, v]) => `${k}=${v}`).join(" ") : e.detail || "")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="small">No entries yet.</p>';
      } catch (err) { host.innerHTML = errorHTML(err); }
    };
    view.querySelector("#pf-audit-refresh")?.addEventListener("click", load);
    load();
  }
  return off;
}

function bindAdmin(body, manifest) {
  const status = body.querySelector("#pf-int-status"), out = body.querySelector("#pf-int-results");
  const buttons = [...body.querySelectorAll(".admin-actions button")];
  const busy = (on) => buttons.forEach((b) => (b.disabled = on));
  const run = async (label, fn) => {
    busy(true);
    status.textContent = label;
    try { await fn(); } catch (err) { status.innerHTML = ""; out.innerHTML = errorHTML(err); } finally { busy(false); }
  };
  body.querySelector("#pf-verify-server").addEventListener("click", () => run("The server is re-computing every fingerprint…", async () => {
    const r = await api.verifyIntegrity();
    status.innerHTML = r.all_match ? `<span class="pill pill-good">All ${fmtInt(r.n_match)} files match</span> checked on the server ${new Date().toLocaleTimeString()}`
      : `<span class="pill pill-crit">${fmtInt(r.n_files - r.n_match)} files changed or missing</span> ${fmtInt(r.n_match)} of ${fmtInt(r.n_files)} match`;
    const rows = [...r.results].sort((a, b) => a.match - b.match);
    out.innerHTML = `<div class="table-wrap scroll-y"><table><thead><tr><th>File</th><th>Kind</th><th>Result</th></tr></thead><tbody>${rows.map((f) => `<tr><td class="mono small">${esc(f.path)}</td><td>${esc(f.kind)}</td><td>${f.match ? '<span class="pill pill-good">✓ matches</span>' : f.missing ? '<span class="pill pill-warn">missing</span>' : '<span class="pill pill-crit">✗ changed</span>'}</td></tr>`).join("")}</tbody></table></div>
      ${r.unlisted_files?.length ? `<p class="small" style="margin-top:6px">${r.unlisted_files.length} files are not in the manifest yet: ${r.unlisted_files.slice(0, 6).map(esc).join(", ")}${r.unlisted_files.length > 6 ? "…" : ""}</p>` : ""}`;
  }));
  body.querySelector("#pf-validate").addEventListener("click", () => run("Running src/verify_semantics.py, the engine check and the unit tests on the server…", async () => {
    const r = await api.runValidation();
    status.innerHTML = `${r.all_pass ? '<span class="pill pill-good">All checks pass</span>' : '<span class="pill pill-crit">Some checks failed</span>'} ${r.semantic.passed} of ${r.semantic.total} semantic checks PASS · ${r.passed} of ${r.total} in total · ${r.seconds} s`;
    const groups = [...new Set(r.checks.map((c) => c.group))];
    out.innerHTML = groups.map((g) => `<h3 class="h3" style="margin-top:10px">${esc(g)}</h3><ul class="check-list">${r.checks.filter((c) => c.group === g).map((c) => `<li>${passPill(c.pass, "PASS", "FLAG")}<div><b>${esc(c.name)}</b>${c.detail ? `<div class="small">${esc(c.detail)}</div>` : ""}</div></li>`).join("")}</ul>`).join("");
  }));
  body.querySelector("#pf-verify-browser").addEventListener("click", () => run("Fetching each website file…", async () => {
    const files = manifest.files.filter((f) => f.kind === "frontend" && f.url);
    await verifyInBrowser(files, status, out);
  }));
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyInBrowser(files, status, out) {
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
  status.innerHTML = bad || miss
    ? `<span class="pill pill-crit">${bad} changed, ${miss} unreachable</span> ${ok} of ${files.length} match`
    : `<span class="pill pill-good">All ${ok} website files match</span> checked in this browser ${new Date().toLocaleTimeString()}`;
  const order = { bad: 0, miss: 1, ok: 2 };
  rows.sort((a, b) => order[a.state] - order[b.state]);
  out.innerHTML = `<div class="table-wrap scroll-y"><table><thead><tr><th>File</th><th class="n">Size</th><th>Result</th></tr></thead><tbody>${rows.map(({ f, state }) => `<tr><td class="mono small">${esc(f.url)}</td><td class="n">${fmtInt(f.bytes)} B</td><td>${state === "ok" ? '<span class="pill pill-good">✓ matches</span>' : state === "bad" ? '<span class="pill pill-crit">✗ changed</span>' : '<span class="pill pill-warn">unreachable</span>'}</td></tr>`).join("")}</tbody></table></div>`;
}
