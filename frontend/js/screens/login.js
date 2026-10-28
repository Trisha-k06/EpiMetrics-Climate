// Sign-in screen. Shown before any other screen when sign-in is required.
import { CONFIG } from "../config.js";
import { login, AuthError } from "../auth.js";
import { ROLES } from "../platform-data.js";
import { esc } from "../format.js";

const DEMO = [
  { username: "viewer", password: "viewer-demo-2026" },
  { username: "analyst", password: "analyst-demo-2026" },
  { username: "admin", password: "admin-demo-2026" },
];

export async function render(view, { reason } = {}) {
  const mock = CONFIG.API_MODE === "mock";
  view.innerHTML = `
    <section class="login-wrap">
      <div class="panel login-card">
        <p class="eyebrow">EpiMetrics-Climate · secure access</p>
        <h1 class="login-title">Sign in</h1>
        ${reason === "timeout" ? '<p class="callout callout-warn" role="alert">You were signed out after 15 minutes without activity. Sign in again to continue.</p>' : ""}
        ${reason === "expired" ? '<p class="callout callout-warn" role="alert">Your session expired. Sign in again to continue.</p>' : ""}
        <form id="login-form" class="stack" novalidate>
          <div class="field"><label for="login-user">Username</label><input id="login-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
          <div class="field"><label for="login-pass">Password</label>
            <div class="pw-row"><input id="login-pass" name="password" type="password" autocomplete="current-password" required><button type="button" class="btn pw-toggle" id="pw-toggle" aria-pressed="false" aria-controls="login-pass">Show</button></div></div>
          <p class="login-error" id="login-error" role="alert" hidden></p>
          <button class="btn btn-primary" type="submit" id="login-submit">Sign in</button>
        </form>
        <p class="small">Your session ends after ${esc(CONFIG.AUTH?.SESSION_IDLE_MINUTES ?? 15)} minutes without activity, or when you close the tab.</p>
      </div>
      ${mock ? `<div class="panel login-demo">
        <h2>Demo accounts</h2>
        <p class="small">For the project demo. Select one to fill the form, then sign in.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Role</th><th>Can</th><th>Username</th><th>Password</th><th><span class="visually-hidden">Fill</span></th></tr></thead>
          <tbody>${DEMO.map((d) => { const r = ROLES[d.username]; return `<tr><td><b>${esc(r.label)}</b></td><td>${esc(r.summary)}</td><td class="mono">${esc(d.username)}</td><td class="mono">${esc(d.password)}</td><td><button type="button" class="btn btn-sm" data-fill="${esc(d.username)}">Use</button></td></tr>`; }).join("")}</tbody>
        </table></div>
        <p class="small" style="margin-top:10px">Passwords are stored only as salted PBKDF2-SHA256 hashes. In this mock version the check runs in your browser; with the live backend the server checks the password and issues a signed token (JWT), and the browser never sees any hash.</p>
      </div>` : ""}
    </section>`;

  const form = view.querySelector("#login-form");
  const user = view.querySelector("#login-user"), pass = view.querySelector("#login-pass");
  const err = view.querySelector("#login-error"), submit = view.querySelector("#login-submit");
  view.querySelector("#pw-toggle").addEventListener("click", (e) => {
    const show = pass.type === "password";
    pass.type = show ? "text" : "password";
    e.currentTarget.textContent = show ? "Hide" : "Show";
    e.currentTarget.setAttribute("aria-pressed", String(show));
  });
  view.querySelectorAll("[data-fill]").forEach((b) => b.addEventListener("click", () => {
    const d = DEMO.find((x) => x.username === b.dataset.fill);
    user.value = d.username; pass.value = d.password;
    submit.focus();
  }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    submit.textContent = "Checking…";
    try {
      await login(user.value, pass.value);
    } catch (ex) {
      err.textContent = ex instanceof AuthError ? ex.message : `Sign-in failed: ${ex.message}`;
      err.hidden = false;
      pass.select();
    } finally {
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });
  user.focus();
}
