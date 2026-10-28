// Team comments attached to a view (district.disease.scenario), optionally pinned to a month.
// Comment text is user input: it is ALWAYS inserted as escaped text, never as HTML.
import { api } from "../api.js";
import { can } from "../auth.js";
import { esc, monthLabel } from "../format.js";
import { errorHTML, toast } from "../ui.js";

export const viewKey = (sel) => `${sel.district}.${sel.disease}.${sel.scenario}`;
const MAX = 1000;

function when(ts) {
  return new Date(ts * 1000).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * host: element · opts: { view, months (for the pin select), month (preselected pin), onPins(pins) }
 * Returns { setView(view), setMonth(month), refresh(), list() }.
 */
export function mountComments(host, opts) {
  let view = opts.view;
  let comments = [];
  let seq = 0;
  const canPost = can("comments.post", { write: true });
  host.classList.add("comments");
  host.innerHTML = `
    <div class="panel-head"><h2>Team comments</h2><span class="small">Team discussion, not results · plain text only</span></div>
    <div class="c-list" aria-live="polite"></div>
    ${canPost ? `<form class="c-form" novalidate>
      <label class="visually-hidden" for="c-text-${opts.id}">Add a comment</label>
      <textarea id="c-text-${opts.id}" class="c-text" rows="3" maxlength="${MAX}" placeholder="Add a note for the team about this view…"></textarea>
      <div class="c-row">
        <div class="field" ${(opts.months || []).length ? "" : "hidden"}><label for="c-month-${opts.id}">Pin to a month (optional)</label>
          <select id="c-month-${opts.id}" class="c-month"><option value="">No month</option>${(opts.months || []).map((m) => `<option value="${esc(m)}">${esc(monthLabel(m))}</option>`).join("")}</select></div>
        <span class="small c-count" aria-live="polite">0 / ${MAX}</span>
        <button class="btn btn-primary" type="submit">Post</button>
      </div>
      <p class="small c-error" role="alert" hidden></p>
    </form>` : `<p class="small">${can("comments.read") ? "You can read the team's comments. Posting is for analyst accounts." : ""}</p>`}`;
  const list = host.querySelector(".c-list");
  const form = host.querySelector(".c-form");

  function render() {
    if (!comments.length) { list.innerHTML = '<p class="small c-empty">No comments on this view yet.</p>'; return; }
    list.innerHTML = comments.map((c) => `<article class="c-item" data-id="${c.id}">
      <header><b>${esc(c.author_name)}</b><span class="small">${esc(c.author_role)} · ${esc(when(c.created_at))}${c.edited_at ? " · edited" : ""}</span>
        ${c.month ? `<span class="pill pill-neutral">📍 ${esc(monthLabel(c.month))}</span>` : ""}</header>
      <p class="c-body"></p>
      ${c.mine && canPost ? `<div class="c-actions"><button type="button" class="btn btn-sm" data-act="edit">Edit</button><button type="button" class="btn btn-sm" data-act="delete">Delete</button></div>` : ""}
    </article>`).join("");
    // text, not HTML
    list.querySelectorAll(".c-item").forEach((el) => { el.querySelector(".c-body").textContent = comments.find((c) => String(c.id) === el.dataset.id).text; });
    opts.onPins?.(comments.filter((c) => c.month).map((c) => ({ month: c.month, author: c.author_name, text: c.text })));
  }

  async function refresh() {
    const my = ++seq;
    if (!can("comments.read")) { host.hidden = true; return; }
    list.innerHTML = '<p class="small">Loading comments…</p>';
    try {
      const r = await api.comments(view);
      if (my !== seq) return;
      comments = r.comments;
      render();
    } catch (err) {
      if (my === seq) list.innerHTML = errorHTML(err);
    }
  }

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const item = btn.closest(".c-item"), id = Number(item.dataset.id);
    const c = comments.find((x) => x.id === id);
    if (btn.dataset.act === "delete") {
      btn.disabled = true;
      try { await api.deleteComment(id); toast("Comment deleted"); refresh(); } catch (err) { toast(err.message); btn.disabled = false; }
      return;
    }
    // inline edit
    const body = item.querySelector(".c-body");
    const ta = document.createElement("textarea");
    ta.className = "c-text";
    ta.maxLength = MAX;
    ta.value = c.text;
    ta.setAttribute("aria-label", "Edit comment");
    body.replaceWith(ta);
    btn.parentElement.innerHTML = '<button type="button" class="btn btn-sm btn-primary" data-save>Save</button><button type="button" class="btn btn-sm" data-cancel>Cancel</button>';
    ta.focus();
    item.querySelector("[data-cancel]").addEventListener("click", render);
    item.querySelector("[data-save]").addEventListener("click", async () => {
      try { await api.editComment(id, ta.value); refresh(); } catch (err) { toast(err.message); }
    });
  });

  if (form) {
    const ta = form.querySelector(".c-text"), count = form.querySelector(".c-count"), errEl = form.querySelector(".c-error");
    const sel = form.querySelector(".c-month");
    if (opts.month) sel.value = opts.month;
    ta.addEventListener("input", () => { count.textContent = `${ta.value.length} / ${MAX}`; });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errEl.hidden = true;
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await api.postComment(view, ta.value, sel.value || null);
        ta.value = "";
        count.textContent = `0 / ${MAX}`;
        toast("Comment posted");
        await refresh();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      } finally { btn.disabled = false; }
    });
  }

  refresh();
  return {
    setView(v) { if (v !== view) { view = v; refresh(); } },
    setMonth(m) { const s = form?.querySelector(".c-month"); if (s) { s.value = m || ""; form.querySelector(".c-text").focus(); } },
    refresh,
    list: () => comments,
  };
}
