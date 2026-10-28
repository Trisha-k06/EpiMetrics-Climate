// Admin console: running the platform, not reading epidemiology. Tabs: usage, users, audit log, data integrity,
// backups, comment moderation and a read-only "view as" preview. Every action is enforced and audited by the server.
import { api, downloadRaw } from "../api.js";
import { setPreview, roleMatrix, currentSession } from "../auth.js";
import { esc, fmtInt, byId } from "../format.js";
import { barChart, seriesLegendHTML } from "../charts.js";
import { errorHTML, loadingHTML, passPill, toast, screenEyebrow } from "../ui.js";

const TABS = [
  { id: "usage", label: "Usage" }, { id: "users", label: "Users" }, { id: "audit", label: "Audit log" },
  { id: "integrity", label: "Data integrity" }, { id: "backups", label: "Backups" }, { id: "comments", label: "Comments" },
  { id: "viewas", label: "View as" },
];
const screenLabel = (id) => { for (const r of roleMatrix()) { const s = r.screens.find((x) => x.id === id); if (s) return s.label; } return id; };
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const when = (iso) => (iso ? iso.replace("T", " ").replace("Z", " UTC") : "never");

let META = null;
export async function render(view, { meta }) {
  META = meta;
  const first = new URLSearchParams(location.hash.split("?")[1] || "").get("tab");
  let active = TABS.some((t) => t.id === first) ? first : "usage";
  view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${screenEyebrow("admin", "Admin console")}</p>
        <h1>Run the platform</h1>
        <p class="lede">Usage, accounts, the audit trail, data integrity, backups and moderation. Every change here is enforced by the server and written to the audit log.</p>
      </div>
    </div>
    <div class="tabs" role="tablist" aria-label="Admin sections">${TABS.map((t) => `<button type="button" role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="${t.id === active}" tabindex="${t.id === active ? 0 : -1}">${esc(t.label)}</button>`).join("")}</div>
    ${TABS.map((t) => `<section class="tab-panel" role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" ${t.id === active ? "" : "hidden"}></section>`).join("")}`;

  const loaded = new Set();
  const open = (id, focus) => {
    active = id;
    view.querySelectorAll('[role="tab"]').forEach((b) => {
      const on = b.id === `tab-${id}`;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    view.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== `panel-${id}`));
    if (!loaded.has(id)) { loaded.add(id); LOADERS[id](view.querySelector(`#panel-${id}`)); }
  };
  const tabs = [...view.querySelectorAll('[role="tab"]')];
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => open(b.id.slice(4)));
    b.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        open(n.id.slice(4), true);
      }
    });
  });
  open(active);
}

const LOADERS = { usage, users, audit, integrity, backups, comments, viewas };

// ---------------------------------------------------------------------------- usage
async function usage(host) {
  host.innerHTML = `<div class="panel stack">
    <form class="controls" id="us-form">
      <div class="field"><label for="us-from">From</label><input type="date" id="us-from" value="${day(-6)}"></div>
      <div class="field"><label for="us-to">To</label><input type="date" id="us-to" value="${day()}"></div>
      <div class="seg" role="group" aria-label="Quick range"><button type="button" data-days="1">Today</button><button type="button" data-days="7" aria-pressed="true">7 days</button><button type="button" data-days="30">30 days</button></div>
      <button class="btn btn-primary" type="submit">Show</button>
    </form>
    <div id="us-body">${loadingHTML()}</div></div>`;
  const form = host.querySelector("#us-form"), body = host.querySelector("#us-body");
  const load = async () => {
    body.innerHTML = loadingHTML();
    try {
      const u = await api.usage({ from: host.querySelector("#us-from").value, to: host.querySelector("#us-to").value });
      const top = (list, title, label = (k) => k) => `<div><h3 class="h3">${esc(title)}</h3>${list.length ? `<div class="table-wrap"><table><thead><tr><th>${esc(title.split(" ").slice(-1)[0])}</th><th class="n">Count</th></tr></thead><tbody>${list.map((x) => `<tr><td>${esc(label(x.key))}</td><td class="n">${fmtInt(x.count)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="small">Nothing in this range.</p>'}</div>`;
      body.innerHTML = `<div class="kpis">
          <article class="kpi"><div class="kpi-label">Active users today</div><div class="kpi-value">${fmtInt(u.active_users_today)}</div></article>
          <article class="kpi"><div class="kpi-label">Active users, 7 days</div><div class="kpi-value">${fmtInt(u.active_users_7d)}</div></article>
          <article class="kpi"><div class="kpi-label">Average session</div><div class="kpi-value">${u.avg_session_minutes ?? "—"}<span class="unit">${u.avg_session_minutes == null ? "" : "min"}</span></div><div class="kpi-compare"><span>${fmtInt(u.sessions)} sessions in range</span></div></article>
          <article class="kpi"><div class="kpi-label">Comments posted</div><div class="kpi-value">${fmtInt(u.comments_posted)}</div><div class="kpi-compare"><span>${fmtInt(u.active_users_range)} active users in range</span></div></article>
        </div>
        <div class="panel" style="margin-top:14px"><div class="panel-head"><h2>Sign-ins per day</h2><span class="small">${esc(u.range.from)} to ${esc(u.range.to)}</span></div>
          <div id="us-legend"></div><div id="us-chart"></div>
          <details class="data-table"><summary>Show the data</summary><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Day</th><th class="n">Active users</th><th class="n">Sign-ins</th><th class="n">Failed sign-ins</th><th class="n">Screens opened</th></tr></thead>
            <tbody>${u.per_day.map((d) => `<tr><td>${esc(d.day)}</td><td class="n">${d.active_users}</td><td class="n">${d.logins}</td><td class="n">${d.failed_logins}</td><td class="n">${d.screen_opens}</td></tr>`).join("")}</tbody></table></div></details>
        </div>
        <div class="grid cols-3" style="margin-top:14px">
          ${top(u.sessions_by_role, "Sessions by role", (k) => roleMatrix().find((r) => r.role === k)?.label || k)}
          ${top(u.top_screens, "Most-opened screens", screenLabel)}
          ${top(u.exports_by_kind, "Exports by kind")}
          ${top(u.top_scenarios, "Most-run scenarios", (k) => { const [d, z, sc] = k.split("|"); return [byId(META.districts, d)?.name, byId(META.diseases, z)?.name, byId(META.scenarios, sc)?.label].join(" · "); })}
          ${top(u.top_districts, "Most-explored districts", (k) => byId(META.districts, k)?.name || k)}
        </div>
        <p class="small" style="margin-top:10px">${esc(u.note)}</p>`;
      const series = [{ label: "Active users", color: "var(--c1)", values: u.per_day.map((d) => d.active_users) },
        { label: "Sign-ins", color: "var(--c2)", values: u.per_day.map((d) => d.logins) },
        { label: "Failed sign-ins", color: "var(--c3)", values: u.per_day.map((d) => d.failed_logins) }];
      body.querySelector("#us-legend").innerHTML = seriesLegendHTML(series);
      barChart(body.querySelector("#us-chart"), { categories: u.per_day.map((d) => d.day.slice(5)), series, valueFmt: (v) => String(Math.round(v)), height: 220, ariaLabel: "Active users, sign-ins and failed sign-ins per day" });
    } catch (err) { body.innerHTML = errorHTML(err); }
  };
  host.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => {
    host.querySelectorAll("[data-days]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    host.querySelector("#us-from").value = day(-(Number(b.dataset.days) - 1));
    host.querySelector("#us-to").value = day();
    load();
  }));
  form.addEventListener("submit", (e) => { e.preventDefault(); load(); });
  load();
}

// ---------------------------------------------------------------------------- users
async function users(host) {
  host.innerHTML = `<div class="panel stack">
    <div class="panel-head"><h2>Accounts</h2><span class="small">Passwords are sent once over the API and stored only as PBKDF2 hashes. Any change ends that user's sessions.</span></div>
    <div id="u-table">${loadingHTML()}</div>
    <details class="advanced"><summary>Create a user</summary>
      <form class="controls" id="u-new" style="margin-top:10px" autocomplete="off">
        <div class="field"><label for="u-name">Username</label><input id="u-name" required pattern="[a-z0-9_]{3,32}" maxlength="32"></div>
        <div class="field"><label for="u-display">Display name</label><input id="u-display" maxlength="60"></div>
        <div class="field"><label for="u-role">Role</label><select id="u-role"></select></div>
        <div class="field"><label for="u-pass">Password (10+ characters)</label><input id="u-pass" type="password" minlength="10" autocomplete="new-password"></div>
        <button class="btn btn-primary" type="submit">Create user</button>
      </form><p class="small" id="u-msg" role="status"></p></details></div>`;
  const msg = host.querySelector("#u-msg");
  const me = currentSession().username;
  const draw = (r) => {
    host.querySelector("#u-role").innerHTML = r.roles.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join("");
    host.querySelector("#u-table").innerHTML = `<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>
      ${r.users.map((u) => `<tr data-user="${esc(u.username)}"><td><b>${esc(u.display_name)}</b><div class="small mono">${esc(u.username)}</div></td>
        <td><label class="visually-hidden" for="role-${esc(u.username)}">Role for ${esc(u.username)}</label><select id="role-${esc(u.username)}" data-act="role" ${u.username === me ? "disabled" : ""}>${r.roles.map((x) => `<option value="${esc(x.id)}" ${x.id === u.role ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></td>
        <td>${u.disabled ? '<span class="pill pill-crit">Disabled</span>' : '<span class="pill pill-good">Active</span>'}</td>
        <td class="small">${esc(when(u.last_login))}</td>
        <td><div class="row">${u.username === me ? '<span class="small">(you)</span>' : `<button type="button" class="btn btn-sm" data-act="toggle">${u.disabled ? "Enable" : "Disable"}</button>`}
          <button type="button" class="btn btn-sm" data-act="reset">Reset password</button></div>
          <form class="row pw-form" hidden><label class="visually-hidden" for="pw-${esc(u.username)}">New password for ${esc(u.username)}</label><input id="pw-${esc(u.username)}" type="password" minlength="10" autocomplete="new-password" placeholder="New password"><button class="btn btn-sm btn-primary" type="submit">Set</button></form></td></tr>`).join("")}</tbody></table></div>`;
  };
  const load = async () => { try { draw(await api.users()); } catch (err) { host.querySelector("#u-table").innerHTML = errorHTML(err); } };
  host.querySelector("#u-table").addEventListener("change", async (e) => {
    if (e.target.dataset.act !== "role") return;
    const name = e.target.closest("tr").dataset.user;
    try { draw(await api.updateUser(name, { role: e.target.value })); toast(`Role changed for ${name}. Their open sessions have ended.`); } catch (err) { toast(err.message); load(); }
  });
  host.querySelector("#u-table").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.tagName === "SELECT") return;
    const row = btn.closest("tr"), name = row.dataset.user;
    if (btn.dataset.act === "toggle") {
      try { draw(await api.updateUser(name, { disabled: btn.textContent === "Disable" })); toast(`${name} updated`); } catch (err) { toast(err.message); }
    }
    if (btn.dataset.act === "reset") {
      const f = row.querySelector(".pw-form");
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector("input").focus();
    }
  });
  host.querySelector("#u-table").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = e.target.closest("tr"), input = e.target.querySelector("input");
    try { await api.resetPassword(row.dataset.user, input.value); input.value = ""; e.target.hidden = true; toast("Password reset. Share it with the user privately."); } catch (err) { toast(err.message); }
  });
  host.querySelector("#u-new").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = host.querySelector("#u-pass");
    try {
      draw(await api.createUser({ username: host.querySelector("#u-name").value.trim().toLowerCase(), display_name: host.querySelector("#u-display").value,
        role: host.querySelector("#u-role").value, password: pass.value }));
      msg.textContent = "User created.";
      e.target.reset();
    } catch (err) { msg.textContent = err.message; } finally { pass.value = ""; }
  });
  load();
}

// ---------------------------------------------------------------------------- audit log
async function audit(host) {
  host.innerHTML = `<div class="panel stack">
    <form class="controls" id="au-form">
      <div class="field"><label for="au-user">User</label><select id="au-user"><option value="">Everyone</option></select></div>
      <div class="field"><label for="au-event">Event</label><select id="au-event"><option value="">All events</option></select></div>
      <div class="field"><label for="au-from">From</label><input type="date" id="au-from"></div>
      <div class="field"><label for="au-to">To</label><input type="date" id="au-to"></div>
      <button class="btn btn-primary" type="submit">Filter</button>
      <button class="btn" type="button" id="au-csv">Export CSV</button>
    </form>
    <div id="au-body">${loadingHTML()}</div></div>`;
  const q = () => ({ user: host.querySelector("#au-user").value, event: host.querySelector("#au-event").value, from: host.querySelector("#au-from").value || null, to: host.querySelector("#au-to").value || null });
  const fill = (sel, values) => { const cur = sel.value; sel.innerHTML = sel.options[0].outerHTML + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join(""); sel.value = cur; };
  api.users().then((r) => fill(host.querySelector("#au-user"), r.users.map((u) => u.username))).catch(() => {});
  const load = async () => {
    const body = host.querySelector("#au-body");
    try {
      const r = await api.auditQuery({ ...q(), limit: 500 });
      fill(host.querySelector("#au-event"), r.actions);
      body.innerHTML = r.entries.length ? `<div class="table-wrap scroll-y tall"><table class="audit-table"><thead><tr><th>Time (UTC)</th><th>Event</th><th>User</th><th>Role</th><th>Result</th><th>Detail</th></tr></thead><tbody>
        ${r.entries.map((e) => `<tr><td class="mono small">${esc(e.ts)}</td><td>${esc(e.action)}</td><td class="mono">${esc(e.user || "—")}</td><td>${esc(e.role || "—")}</td><td>${e.status === "ok" ? '<span class="pill pill-good">ok</span>' : `<span class="pill pill-warn">${esc(e.status)}</span>`}</td><td class="detail small">${esc(typeof e.detail === "object" && e.detail ? Object.entries(e.detail).map(([k, v]) => `${k}=${v}`).join(" ") : e.detail || "")}</td></tr>`).join("")}</tbody></table></div>
        <p class="small" style="margin-top:6px">${r.entries.length} entries shown (newest first, up to 500).</p>` : '<p class="small">No entries match these filters.</p>';
    } catch (err) { body.innerHTML = errorHTML(err); }
  };
  host.querySelector("#au-form").addEventListener("submit", (e) => { e.preventDefault(); load(); });
  host.querySelector("#au-csv").addEventListener("click", async () => {
    try {
      const { blob, filename } = await downloadRaw("audit-log.csv", q());
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast("Audit log exported");
    } catch (err) { toast(err.message); }
  });
  load();
}

// ---------------------------------------------------------------------------- integrity
async function integrity(host) {
  host.innerHTML = `<div class="panel stack">
    <div id="in-summary">${loadingHTML("Loading the checksum manifest…")}</div>
    <div class="admin-actions">
      <button class="btn btn-primary" type="button" id="pf-verify-server">Verify files on the server</button>
      <button class="btn" type="button" id="pf-validate">Run validation scripts</button>
      <button class="btn" type="button" id="pf-verify-browser">Re-check website files in this browser</button>
    </div>
    <p class="small" id="pf-int-status" role="status" aria-live="polite"></p>
    <div id="pf-int-results"></div></div>`;
  const status = host.querySelector("#pf-int-status"), out = host.querySelector("#pf-int-results");
  let manifest = null;
  try {
    manifest = await api.integrity();
    const counts = (manifest.files || []).reduce((a, f) => ({ ...a, [f.kind]: (a[f.kind] || 0) + 1 }), {});
    host.querySelector("#in-summary").innerHTML = manifest.available === false ? '<p>No manifest yet: run <span class="mono">python -m backend.manage manifest</span>.</p>'
      : `<p>The manifest lists <b>${fmtInt(manifest.files.length)}</b> files (${Object.entries(counts).map(([k, v]) => `${v} ${esc(k)}`).join(", ")}), made ${esc(manifest.generated_at)}.</p>`;
  } catch (err) { host.querySelector("#in-summary").innerHTML = errorHTML(err); }
  const buttons = [...host.querySelectorAll(".admin-actions button")];
  const run = async (label, fn) => {
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = label;
    try { await fn(); } catch (err) { status.textContent = ""; out.innerHTML = errorHTML(err); } finally { buttons.forEach((b) => (b.disabled = false)); }
  };
  host.querySelector("#pf-verify-server").addEventListener("click", () => run("The server is re-computing every fingerprint…", async () => {
    const r = await api.verifyIntegrity();
    status.innerHTML = r.all_match ? `<span class="pill pill-good">All ${fmtInt(r.n_match)} files match</span> checked on the server ${new Date().toLocaleTimeString()}`
      : `<span class="pill pill-crit">${fmtInt(r.n_files - r.n_match)} files changed or missing</span> ${fmtInt(r.n_match)} of ${fmtInt(r.n_files)} match`;
    const rows = [...r.results].sort((a, b) => a.match - b.match);
    out.innerHTML = `<div class="table-wrap scroll-y"><table><thead><tr><th>File</th><th>Kind</th><th>Result</th></tr></thead><tbody>${rows.map((f) => `<tr><td class="mono small">${esc(f.path)}</td><td>${esc(f.kind)}</td><td>${f.match ? '<span class="pill pill-good">✓ matches</span>' : f.missing ? '<span class="pill pill-warn">missing</span>' : '<span class="pill pill-crit">✗ changed</span>'}</td></tr>`).join("")}</tbody></table></div>
      ${r.unlisted_files?.length ? `<p class="small" style="margin-top:6px">${r.unlisted_files.length} files are not in the manifest yet: ${r.unlisted_files.slice(0, 6).map(esc).join(", ")}${r.unlisted_files.length > 6 ? "…" : ""}</p>` : ""}`;
  }));
  host.querySelector("#pf-validate").addEventListener("click", () => run("Running src/verify_semantics.py, the engine check and the unit tests on the server…", async () => {
    const r = await api.runValidation();
    status.innerHTML = `${r.all_pass ? '<span class="pill pill-good">All checks pass</span>' : '<span class="pill pill-crit">Some checks failed</span>'} ${r.semantic.passed} of ${r.semantic.total} semantic checks PASS · ${r.passed} of ${r.total} in total · ${r.seconds} s`;
    const groups = [...new Set(r.checks.map((c) => c.group))];
    out.innerHTML = groups.map((g) => `<h3 class="h3" style="margin-top:10px">${esc(g)}</h3><ul class="check-list">${r.checks.filter((c) => c.group === g).map((c) => `<li>${passPill(c.pass, "PASS", "FLAG")}<div><b>${esc(c.name)}</b>${c.detail ? `<div class="small">${esc(c.detail)}</div>` : ""}</div></li>`).join("")}</ul>`).join("");
  }));
  host.querySelector("#pf-verify-browser").addEventListener("click", () => run("Fetching each website file…", async () => {
    const files = (manifest?.files || []).filter((f) => f.kind === "frontend" && f.url);
    let ok = 0, bad = 0, miss = 0;
    const rows = [];
    for (let i = 0; i < files.length; i++) {
      status.textContent = `Checking ${i + 1} of ${files.length}…`;
      let state = "miss";
      const res = await fetch(files[i].url, { cache: "no-store" }).catch(() => null);
      if (res?.ok) state = (await sha256Hex(await res.arrayBuffer())) === files[i].sha256 ? "ok" : "bad";
      if (state === "ok") ok++; else if (state === "bad") bad++; else miss++;
      rows.push({ f: files[i], state });
    }
    status.innerHTML = bad || miss ? `<span class="pill pill-crit">${bad} changed, ${miss} unreachable</span> ${ok} of ${files.length} match`
      : `<span class="pill pill-good">All ${ok} website files match</span> checked in this browser ${new Date().toLocaleTimeString()}`;
    rows.sort((a, b) => ({ bad: 0, miss: 1, ok: 2 }[a.state] - { bad: 0, miss: 1, ok: 2 }[b.state]));
    out.innerHTML = `<div class="table-wrap scroll-y"><table><thead><tr><th>File</th><th class="n">Size</th><th>Result</th></tr></thead><tbody>${rows.map(({ f, state }) => `<tr><td class="mono small">${esc(f.url)}</td><td class="n">${fmtInt(f.bytes)} B</td><td>${state === "ok" ? '<span class="pill pill-good">✓ matches</span>' : state === "bad" ? '<span class="pill pill-crit">✗ changed</span>' : '<span class="pill pill-warn">unreachable</span>'}</td></tr>`).join("")}</tbody></table></div>`;
  }));
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------- backups
async function backups(host) {
  host.innerHTML = `<div class="panel stack">
    <div class="row" style="justify-content:space-between"><p class="small" style="max-width:70ch">Each archive holds the database (saved views, comments, usage), the accounts file, the integrity manifest and the audit log, with a SHA-256 checksum. The newest 14 are kept.</p>
      <button class="btn btn-primary" type="button" id="bk-now">Back up now</button></div>
    <p class="small" id="bk-status" role="status" aria-live="polite"></p>
    <div id="bk-list">${loadingHTML()}</div>
    <p class="small" id="bk-restore"></p></div>`;
  const draw = (r) => {
    host.querySelector("#bk-restore").textContent = r.restore;
    host.querySelector("#bk-list").innerHTML = r.backups.length ? `<div class="table-wrap"><table><thead><tr><th>Archive</th><th>Created</th><th class="n">Size</th><th>SHA-256</th></tr></thead><tbody>
      ${r.backups.map((b) => `<tr><td class="mono small">${esc(b.name)}</td><td class="small">${esc(when(b.created_at))}</td><td class="n">${fmtInt(b.bytes)} B</td><td class="mono small" title="${esc(b.sha256)}">${esc((b.sha256 || "").slice(0, 16))}…</td></tr>`).join("")}</tbody></table></div>`
      : '<p class="small">No backups yet.</p>';
  };
  try { draw(await api.backups()); } catch (err) { host.querySelector("#bk-list").innerHTML = errorHTML(err); }
  host.querySelector("#bk-now").addEventListener("click", async (e) => {
    const btn = e.currentTarget; // currentTarget is null again after the first await
    btn.disabled = true;
    const st = host.querySelector("#bk-status");
    st.textContent = "Writing the archive…";
    try { const r = await api.createBackup(); draw(r); st.innerHTML = `<span class="pill pill-good">Backup written</span> ${esc(r.backup.name)}`; } catch (err) { st.textContent = err.message; } finally { btn.disabled = false; }
  });
}

// ---------------------------------------------------------------------------- comments
async function comments(host) {
  host.innerHTML = `<div class="panel stack"><div class="panel-head"><h2>Comment moderation</h2><span class="small">Hide keeps a comment out of every view and export; delete removes it. Both are audited.</span></div><div id="cm-list">${loadingHTML()}</div></div>`;
  const list = host.querySelector("#cm-list");
  const load = async () => {
    try {
      const r = await api.adminComments();
      if (!r.comments.length) { list.innerHTML = '<p class="small">No comments yet.</p>'; return; }
      list.innerHTML = `<div class="table-wrap scroll-y tall"><table><thead><tr><th>View</th><th>Author</th><th>Comment</th><th>State</th><th>Actions</th></tr></thead><tbody>
        ${r.comments.map((c) => `<tr data-id="${c.id}"><td class="mono small">${esc(c.view_key)}${c.month ? `<br>${esc(c.month)}` : ""}</td><td>${esc(c.author_name)}<div class="small">${esc(c.author_role)}</div></td>
          <td class="c-cell"></td><td>${c.hidden ? '<span class="pill pill-warn">Hidden</span>' : '<span class="pill pill-good">Visible</span>'}</td>
          <td><div class="row"><button type="button" class="btn btn-sm" data-act="${c.hidden ? "unhide" : "hide"}">${c.hidden ? "Unhide" : "Hide"}</button><button type="button" class="btn btn-sm" data-act="delete">Delete</button></div></td></tr>`).join("")}</tbody></table></div>`;
      list.querySelectorAll("tr[data-id]").forEach((tr) => { tr.querySelector(".c-cell").textContent = r.comments.find((c) => String(c.id) === tr.dataset.id).text; });
    } catch (err) { list.innerHTML = errorHTML(err); }
  };
  list.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.closest("tr").dataset.id;
    try {
      if (b.dataset.act === "delete") await api.adminDeleteComment(id); else await api.moderateComment(id, b.dataset.act === "hide");
      toast("Done");
      load();
    } catch (err) { toast(err.message); }
  });
  load();
}

// ---------------------------------------------------------------------------- view as
async function viewas(host) {
  const roles = roleMatrix().filter((r) => r.role !== "admin");
  host.innerHTML = `<div class="panel stack"><div class="panel-head"><h2>See what each audience sees</h2><span class="small">A read-only preview. Your own role does not change, and the switch is written to the audit log.</span></div>
    <div class="user-grid">${roles.map((r) => `<article class="user-card"><h3>${esc(r.label)}</h3><p>${esc(r.summary)}</p><p class="small">${r.screens.map((x) => esc(x.label)).join(" · ")}</p>
      <button type="button" class="btn btn-primary" data-role="${esc(r.role)}">View as ${esc(r.label)}</button></article>`).join("")}</div></div>`;
  host.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", async () => {
    try { await setPreview(b.dataset.role); location.hash = roles.find((r) => r.role === b.dataset.role).home; } catch (err) { toast(err.message); }
  }));
}
