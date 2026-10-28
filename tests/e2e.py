"""End-to-end test of the website and API in a real browser (Playwright + Chromium).

    python tests/e2e.py            # starts its own servers on ports 8765 and 8766

For each role (junior, viewer, analyst, admin): every allowed screen at 1440×900 and 390×844 in Day and Night,
failing on any console error, page error, failed request or sideways scrolling; forbidden screens must show the
friendly message. Then the flows: compare, map drill-down to a month, saved view across sign-out, comment → PDF
(read back with pypdf), XSS as text, admin usage/backup/view-as/role change, masks, WebGL and 2D map, assistant,
Young Minds lab and quiz, lockout and session expiry. Screenshots: tests/screenshots/<role>/.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "tests" / "screenshots"
DOWNLOADS = ROOT / "tests" / "downloads"
PORT, EXPIRY_PORT = 8765, 8766
PASSWORDS = {r: f"{r}-demo-2026" for r in ("junior", "viewer", "analyst", "admin")}
VIEWPORTS = {"desktop": {"width": 1440, "height": 900}, "phone": {"width": 390, "height": 844}}
FORBIDDEN_PROBE = {"junior": "overview", "viewer": "validation", "analyst": "admin", "admin": "validation"}

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = ""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{f' — {detail}' if detail else ''}", flush=True)


def start_server(port: int, tmp: Path, **env) -> subprocess.Popen:
    e = {**os.environ, "EPIMETRICS_PORT": str(port), "EPIMETRICS_USERS_FILE": str(tmp / f"users_{port}.json"),
         "EPIMETRICS_AUDIT_FILE": str(tmp / f"audit_{port}.jsonl"), "EPIMETRICS_DB_FILE": str(tmp / f"app_{port}.db"),
         "EPIMETRICS_BACKUP_DIR": str(tmp / f"backups_{port}"), **env}
    proc = subprocess.Popen([sys.executable, "-m", "backend"], cwd=ROOT, env=e, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health", timeout=1)
            return proc
        except Exception:
            time.sleep(0.25)
    proc.kill()
    raise RuntimeError(f"server on port {port} did not start")


def wait_models(port: int):
    for _ in range(240):
        if json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health"))["models_ready"]:
            return
        time.sleep(0.5)


class Watch:
    """Console errors, page errors, failed requests and HTTP errors for one page. Any JS dialog (alert) is a failure:
    comment text must never execute."""

    def __init__(self, page, allow=()):
        self.items: list[str] = []
        self.allow = allow
        page.on("console", lambda m: m.type == "error" and not any(f"status of {s}" in m.text for s in self.allow) and self.items.append(f"console: {m.text}"))
        page.on("pageerror", lambda e: self.items.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: self.items.append(f"requestfailed: {r.url} {r.failure}"))
        page.on("response", lambda r: r.status >= 400 and r.status not in self.allow and self.items.append(f"http {r.status}: {r.url}"))
        page.on("dialog", lambda d: (self.items.append(f"dialog: {d.message}"), d.dismiss()))

    def take(self):
        out, self.items = self.items, []
        return out


def base(port=PORT):
    return f"http://127.0.0.1:{port}/"


def sign_in(page, user, password=None, port=PORT, wait=True):
    page.goto(base(port))
    page.wait_for_selector("#login-form")
    page.fill("#login-user", user)
    page.fill("#login-pass", password or PASSWORDS[user])
    page.click("#login-submit")
    if wait:
        page.wait_for_function("() => location.hash.length > 1 && !document.querySelector('#login-form')", timeout=30000)
        wait_ready(page)


def wait_ready(page, timeout=90000):
    page.wait_for_function("() => !document.querySelector('#view [aria-busy=\"true\"]') && !document.querySelector('#view .skeleton')", timeout=timeout)
    page.wait_for_timeout(600)


def goto(page, route):
    page.evaluate(f"location.hash = '{route}'")
    page.wait_for_function(f"() => location.hash === '#{route}'")
    page.wait_for_timeout(150)
    wait_ready(page)


def overflow(page):
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


def screens_of(page):
    return page.evaluate("() => JSON.parse(sessionStorage.getItem('epimetrics.session.v3')).access.screens.map(s => s.id)")


def api(page, method, path, body=None):
    """Call the API from the page with the signed-in user's token; returns [status, json]."""
    return page.evaluate("""async ([method, path, body]) => {
      const t = JSON.parse(sessionStorage.getItem('epimetrics.session.v3')).token;
      const r = await fetch('/api/v1' + path, { method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return [r.status, await r.json().catch(() => null)];
    }""", [method, path, body])


# ---------------------------------------------------------------------------- sweep
def sweep(browser):
    for role in PASSWORDS:
        (SHOTS / role).mkdir(parents=True, exist_ok=True)
        for vp_name, vp in VIEWPORTS.items():
            ctx = browser.new_context(viewport=vp, reduced_motion="reduce")
            page = ctx.new_page()
            w = Watch(page)
            sign_in(page, role)
            screens = screens_of(page)
            home = page.evaluate("location.hash")
            if vp_name == "desktop":
                check(f"{role} lands on its home", home == f"#{screens[0]}", home)
            for theme in ("light", "dark"):
                page.click(f"[data-theme-choice={theme}]")
                for r in screens:
                    goto(page, r)
                    errs = w.take()
                    ov = overflow(page)
                    panels = page.locator("#view .state-error").count()
                    page.screenshot(path=str(SHOTS / role / f"{vp_name}_{theme}_{r}.png"), full_page=True)
                    check(f"{role} {vp_name} {theme} #{r}", not errs and ov <= 0 and panels == 0,
                          "; ".join(errs[:3]) + (f" overflow {ov}px" if ov > 0 else "") + (f" {panels} error panels" if panels else ""))
            probe = FORBIDDEN_PROBE[role]
            goto(page, probe)
            check(f"{role} {vp_name}: #{probe} shows the friendly message", page.locator(".not-available").count() == 1 and not w.take())
            ctx.close()


# ---------------------------------------------------------------------------- flows
def compare_flow(browser):
    page = browser.new_page(viewport=VIEWPORTS["desktop"])
    w = Watch(page)
    sign_in(page, "analyst")
    goto(page, "compare")
    page.select_option("#cmp-a", "delayed_monsoon")
    page.select_option("#cmp-b", "warmer")
    page.wait_for_function("() => /Warmer.*sooner/.test(document.querySelector('#cmp-answer').textContent)", timeout=30000)
    ans = " ".join(page.inner_text("#cmp-answer").split())
    check("compare two scenarios", "8 months sooner" in ans and "difference of the two api values" in ans.lower(), ans[:140])
    # fast switching must end on the last selection (sequence ids)
    for sc in ("heavy_rain_decline", "prolonged_wet", "irregular_rain"):
        page.select_option("#cmp-b", sc)
    page.wait_for_function("() => /Irregular rain/.test(document.querySelector('#cmp-answer').textContent)", timeout=30000)
    check("compare keeps the latest selection after fast changes", "Irregular rain" in page.inner_text("#cmp-cols"))
    page.click("#view details.advanced > summary")  # "Compare across districts" lives in Advanced options
    page.select_option("#cmp-d2", "mdu")
    page.wait_for_function("() => /Madurai/.test(document.querySelector('#cmp-answer').textContent)", timeout=30000)
    check("compare the same scenario across two districts", "Madurai" in page.inner_text("#cmp-answer") and not w.take())
    page.select_option("#cmp-d2", "")
    page.screenshot(path=str(SHOTS / "check_compare.png"), full_page=True)
    page.close()


def drill_flow(browser):
    page = browser.new_page(viewport=VIEWPORTS["desktop"])
    w = Watch(page)
    sign_in(page, "viewer")
    goto(page, "map")
    page.wait_for_selector("#mp-map .map-label[data-id=tnj]", timeout=30000)
    page.click("#mp-map .map-label[data-id=tnj]")
    page.wait_for_function("() => /Thanjavur/.test(document.querySelector('#mp-drill h2')?.textContent || '')")
    page.click("#mp-drill [data-dis=malaria]")
    page.wait_for_function("() => /Malaria/.test(document.querySelector('#mp-drill h2')?.textContent || '') && document.querySelector('#mp-drill [data-year]')")
    page.click("#mp-drill [data-year='2023']")
    # wait until the panel has redrawn for 2023 before picking a month
    page.wait_for_selector("#mp-drill [data-year='2023'][aria-pressed=true]")
    page.wait_for_selector("#mp-drill .drill-chart svg .hover-zone")
    page.wait_for_timeout(400)
    zone = page.locator("#mp-drill .drill-chart svg .hover-zone")
    zone.scroll_into_view_if_needed()
    box = zone.bounding_box()
    page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
    page.wait_for_selector("#mp-drill .drill-month")
    crumbs = page.inner_text("#mp-drill .crumbs")
    detail = page.inner_text("#mp-drill .drill-month")
    check("drill-down map → district → disease → month", all(x in crumbs for x in ("Tamil Nadu", "Thanjavur", "Malaria", "2023")) and "Endemic threshold" in detail,
          crumbs.replace("\n", " "))
    page.click("#mp-drill .crumbs [data-crumb='1']")
    page.wait_for_timeout(500)
    check("breadcrumb goes back up", page.locator("#mp-drill .drill-month").count() == 0 and not w.take())
    page.screenshot(path=str(SHOTS / "check_drilldown.png"), full_page=True)
    page.close()


def saved_flow(browser):
    ctx = browser.new_context(viewport=VIEWPORTS["desktop"])
    page = ctx.new_page()
    w = Watch(page)
    sign_in(page, "analyst")
    goto(page, "simulator")
    page.select_option("#sim-district", "mdu")
    page.select_option("#sim-disease", "malaria")
    page.check("input[name=scenario][value=irregular_rain]", force=True)
    wait_ready(page)
    page.click("#sim-save [data-open]")
    page.fill("#sv-name", "E2E Madurai malaria irregular")
    page.click("#sim-save button[type=submit]")
    page.wait_for_timeout(800)
    page.click("#uc-out")
    page.wait_for_selector("#login-form")
    sign_in(page, "analyst")
    page.wait_for_selector("#ov-saved .saved-open")
    names = page.inner_text("#ov-saved")
    page.locator("#ov-saved .saved-open", has_text="E2E Madurai malaria irregular").click()
    page.wait_for_function("() => location.hash === '#simulator'")
    wait_ready(page)
    title = page.inner_text("#sim-chart-title")
    check("saved view survives sign-out and reopens", "E2E Madurai malaria irregular" in names and "Malaria cases in Madurai" in title and "irregular" in title.lower() and not w.take(), title)
    ctx.close()
    ctx2 = browser.new_context()
    p2 = ctx2.new_page()
    sign_in(p2, "viewer")
    _, mine = api(p2, "GET", "/me/saved")
    check("saved views are private to their owner", all(s["name"] != "E2E Madurai malaria irregular" for s in mine["saved"]))
    ctx2.close()


def comment_pdf_flow(browser):
    ctx = browser.new_context(viewport=VIEWPORTS["desktop"], accept_downloads=True)
    page = ctx.new_page()
    w = Watch(page)
    sign_in(page, "analyst")
    goto(page, "report")
    page.select_option("#rep-district", "cbe")
    page.select_option("#rep-disease", "dengue")
    page.select_option("#rep-scenario", "delayed_monsoon")
    wait_ready(page)
    note = "E2E team note: check drainage before the 2023 wave"
    evil = '<script>alert("x")</script><img src=x onerror="alert(1)"> 🦟 தமிழ்'
    for text in (note, evil, "x" * 1000):
        page.fill("#rep-comments .c-text", text)
        page.click("#rep-comments button[type=submit]")
        page.wait_for_timeout(500)
    page.wait_for_function("() => document.querySelectorAll('#rep-comments .c-item').length >= 3")
    bodies = page.locator("#rep-comments .c-body").all_inner_texts()
    injected = page.evaluate("() => !!document.querySelector('#rep-comments .c-body script, #rep-comments .c-body img')")
    check("comment XSS renders as text", any("<script>" in b for b in bodies) and not injected)
    page.click("#rep-export")
    with page.expect_download(timeout=60000) as dl:
        page.click("#rep-export-list [data-item=report_pdf]")
    path = DOWNLOADS / dl.value.suggested_filename
    dl.value.save_as(path)
    text = "\n".join(p.extract_text() for p in PdfReader(str(path)).pages)
    flat = " ".join(text.split())
    check("report PDF contains the team comment", "Team comments" in flat and note in flat and "[?]" in flat, f"{path.name}, {path.stat().st_size} bytes")
    for kind in ("csv", "json"):
        page.click("#rep-export")
        with page.expect_download(timeout=30000) as dl:
            page.click(f"#rep-export-list [data-item={kind}]")
        p = DOWNLOADS / dl.value.suggested_filename
        dl.value.save_as(p)
        check(f"analyst downloads {kind.upper()}", p.stat().st_size > 500, f"{p.name}, {p.stat().st_size} bytes")
    goto(page, "technology")
    with page.expect_download(timeout=120000) as dl:
        page.click("#pdf-export")
    p = DOWNLOADS / dl.value.suggested_filename
    dl.value.save_as(p)
    page.wait_for_function("() => /pages/.test(document.querySelector('#pdf-status').textContent)", timeout=30000)
    check("analyst downloads the project PDF", p.read_bytes()[:5] == b"%PDF-" and p.stat().st_size > 5000, page.inner_text("#pdf-status"))
    check("comment and export flow had no errors", not w.take())
    page.screenshot(path=str(SHOTS / "check_report_comments.png"), full_page=True)
    ctx.close()


def viewer_limits(browser):
    page = browser.new_page(viewport=VIEWPORTS["desktop"])
    w = Watch(page, allow=(403,))
    sign_in(page, "viewer")
    goto(page, "report")
    page.click("#rep-export")
    items = page.locator("#rep-export-list [data-item]").evaluate_all("els => els.map(e => e.dataset.item)")
    check("viewer export menu: PDF and print only", items == ["report_pdf", "print"], str(items))
    check("viewer cannot post comments", page.locator("#rep-comments .c-form").count() == 0)
    statuses = [api(page, "POST", "/exports", {"kind": "csv"})[0], api(page, "GET", "/validation?disease=dengue")[0],
                api(page, "GET", "/analytics/episodes?disease=dengue")[0], api(page, "POST", "/comments", {"view": "cbe.dengue.baseline", "text": "x"})[0]]
    check("server refuses viewer CSV, validation, analytics and posting (403)", statuses == [403, 403, 403, 403], str(statuses))
    page.close()


def admin_flow(browser, before_usage):
    page = browser.new_page(viewport=VIEWPORTS["desktop"])
    w = Watch(page)
    sign_in(page, "admin")
    page.wait_for_selector("#panel-usage .kpi")
    _, after = api(page, "GET", "/admin/usage")
    top = {x["key"]: x["count"] for x in after["top_screens"]}
    check("admin sees usage change after the flows", after["comments_posted"] > before_usage["comments_posted"] and top.get("compare", 0) > 0
          and any(x["key"] == "report_pdf" for x in after["exports_by_kind"]), f"comments {before_usage['comments_posted']}→{after['comments_posted']}")
    page.click("#tab-backups")
    page.click("#bk-now")
    page.wait_for_function("() => /Backup written/.test(document.querySelector('#bk-status').textContent)", timeout=30000)
    check("admin runs a backup", page.locator("#bk-list tbody tr").count() >= 1, page.inner_text("#bk-status"))
    page.click("#tab-integrity")
    page.click("#pf-verify-server")
    page.wait_for_function("() => /files match|changed/.test(document.querySelector('#pf-int-status').textContent)", timeout=60000)
    st = page.inner_text("#pf-int-status")
    check("admin: verify files on the server — all match", "files match" in st and "changed" not in st, st)
    page.click("#pf-validate")
    page.wait_for_function("() => /semantic checks/.test(document.querySelector('#pf-int-status').textContent)", timeout=300000)
    st = page.inner_text("#pf-int-status")
    check("admin: run validation — 34 PASS", "34 of 34 semantic checks PASS" in st and "All checks pass" in st, st)
    page.click("#pf-verify-browser")
    page.wait_for_function("() => /website files match|changed/.test(document.querySelector('#pf-int-status').textContent)", timeout=120000)
    check("admin: browser re-check of website files", "website files match" in page.inner_text("#pf-int-status"))
    page.click("#tab-comments")
    page.wait_for_selector("#cm-list tr[data-id]")
    row = page.locator("#cm-list tr[data-id]").first
    row.locator("[data-act=hide]").click()
    page.wait_for_function("() => document.querySelector('#cm-list .pill-warn')")
    check("admin hides a comment", page.locator("#cm-list .pill-warn", has_text="Hidden").count() >= 1)
    page.click("#tab-audit")
    page.wait_for_selector("#au-event option[value=comment_hide]", state="attached")
    page.select_option("#au-event", "comment_hide")
    page.click("#au-form button[type=submit]")
    page.wait_for_timeout(600)
    with page.expect_download() as dl:
        page.click("#au-csv")
    p = DOWNLOADS / dl.value.suggested_filename
    dl.value.save_as(p)
    check("admin exports the audit log as CSV", p.read_text().startswith("ts,action,user,role,ip,status,detail"), p.name)
    # user management and a role change while signed in
    page.click("#tab-users")
    page.click("#panel-users details.advanced > summary")
    page.fill("#u-name", "e2e_rolechange")
    page.fill("#u-display", "Role change test")
    page.select_option("#u-role", "analyst")
    page.fill("#u-pass", "e2e-password-123")
    page.click("#u-new button[type=submit]")
    page.wait_for_selector("tr[data-user=e2e_rolechange]")
    other = browser.new_context().new_page()
    sign_in(other, "e2e_rolechange", "e2e-password-123")
    check("new user signs in with its role", "episodes" in screens_of(other))
    page.select_option("#role-e2e_rolechange", "viewer")
    page.wait_for_timeout(800)
    other.evaluate("location.hash = 'episodes'")  # the next API call after the change
    other.wait_for_selector("#login-form", timeout=30000)
    check("role change ends the user's session with a clear message", "changed your account" in other.inner_text("#view"))
    other.close()
    # view as
    page.click("#tab-viewas")
    page.click("[data-role=viewer]")
    page.wait_for_function("() => location.hash === '#overview' && !document.querySelector('#preview-strip').hidden")
    wait_ready(page)
    nav = page.locator(".sidenav a").all_inner_texts()
    st, body = api(page, "GET", "/meta")
    check("view as Viewer shows the viewer menu, read-only", "Outbreak episodes" not in " ".join(nav) and "Previewing as Viewer" in page.inner_text("#preview-strip"), " · ".join(n.split("\n")[-1] for n in nav))
    page.click("#preview-exit")
    page.wait_for_function("() => location.hash === '#admin' && document.querySelector('#preview-strip').hidden")
    check("exit preview returns to the admin console", True)
    errs = w.take()
    check("admin flows had no errors", not errs, "; ".join(errs[:3]))
    page.screenshot(path=str(SHOTS / "check_admin.png"), full_page=True)
    page.close()


def mask_checks(browser):
    page = browser.new_page(viewport=VIEWPORTS["desktop"])
    w = Watch(page)
    sign_in(page, "analyst")
    goto(page, "simulator")
    page.click("#view details.advanced > summary")
    page.select_option("#sim-mask", "cases_gap_3m")
    page.wait_for_function("() => /no reported cases/.test(document.querySelector('#sim-view').textContent)", timeout=30000)
    try:
        page.wait_for_function("() => [...document.querySelectorAll('#sim-cases svg path')].some((p) => (p.getAttribute('d') || '').split('M').length > 2)", timeout=15000)
        broken = True
    except Exception:
        broken = False
    check("mask 3-month gap: chart shows gaps, no crash", broken and page.locator("#sim-view .swatch-gap").count() > 0 and not w.take())
    page.select_option("#sim-mask", "cases_outage_9m")
    page.wait_for_function("() => /Not enough reported months/.test(document.querySelector('#sim-answer').textContent)", timeout=30000)
    check("mask 9-month outage: insufficient data", page.locator("#sim-view", has_text="Insufficient data").count() == 1 and not w.take())
    page.select_option("#sim-mask", "none")
    wait_ready(page)
    page.close()


def map_checks(p):
    for label, args in (("WebGL", []), ("2D fallback", ["--disable-webgl", "--disable-3d-apis"])):
        b = p.chromium.launch(args=args)
        page = b.new_page(viewport=VIEWPORTS["desktop"])
        w = Watch(page)
        sign_in(page, "analyst")
        page.wait_for_selector("#ov-map .map-label", timeout=30000)
        hero_canvas = page.locator("#ov-map canvas").count() > 0
        hero_2d = page.locator("#ov-map svg.map2d").count() > 0
        cards_clear = page.evaluate("""() => { const card = document.querySelector('.hero-cards').getBoundingClientRect();
          return [...document.querySelectorAll('#ov-map .map-label')].every((l) => { const r = l.getBoundingClientRect(); return r.left >= card.right - 2 || r.bottom <= card.top || r.top >= card.bottom; }); }""")
        goto(page, "recovery")
        page.wait_for_selector("#rec-map .map-label", timeout=30000)
        for layer in ("peak", "flood", "density", "result"):
            page.click(f"[data-layer={layer}]")
            page.wait_for_timeout(250)
        page.hover("#rec-map .map-label[data-id=cbe]")
        page.wait_for_timeout(300)
        tip = page.inner_text("#rec-map .map-tip") if page.locator("#rec-map .map-tip").is_visible() else ""
        page.screenshot(path=str(SHOTS / f"check_map_{'webgl' if not args else '2d'}.png"))
        ok = (hero_canvas and not hero_2d) if not args else (hero_2d and not hero_canvas)
        check(f"home hero map loads ({label})", ok, f"canvas={hero_canvas} svg2d={hero_2d}")
        check(f"hero cards don't cover the district labels ({label})", cards_clear)
        check(f"map layers and profile hover ({label})", "Flood exposure" in tip and not w.take(), tip[:60].replace("\n", " "))
        b.close()


def assistant_checks(browser):
    page = browser.new_page(viewport=VIEWPORTS["desktop"])
    w = Watch(page)
    sign_in(page, "analyst")
    page.click("#as-open")
    for q, expect in [("What is TSR?", "Time to Sustained Recovery"), ("Why does recovery take longer here?", "recovery delay"),
                      ("Which forecast model is best?", "lowest error"), ("How many outbreak episodes?", "602 outbreak episodes"),
                      ("what medicine should I take", "can't help with medical questions")]:
        n = page.locator(".as-bot").count()
        page.fill("#as-input", q)
        page.press("#as-input", "Enter")
        page.wait_for_function(f"() => document.querySelectorAll('.as-bot').length > {n} && !document.querySelector('.as-typing')", timeout=60000)
        ans = page.locator(".as-bot").last.inner_text()
        check(f"assistant: {q}", expect.lower() in ans.lower(), ans[:90].replace("\n", " "))
    check("assistant had no errors", not w.take())
    page.close()


def young_checks(browser):
    page = browser.new_page(viewport={"width": 1024, "height": 768}, has_touch=True)  # tablet
    w = Watch(page)
    sign_in(page, "junior")
    scripts = page.evaluate("() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /screens\\//.test(n) && !/login\\.js/.test(n))")
    check("Young Minds loads no analyst screen modules (sign-in screen excepted)", not scripts, ", ".join(s.rsplit("/", 1)[-1] for s in scripts))
    check("Young Minds shows the pretend-data banner and no typing", page.locator(".y-banner").count() == 1 and page.locator("#view textarea, #view input[type=text]").count() == 0)
    goto(page, "young-lab")
    page.click("#y-late")
    page.wait_for_function("() => /calm down|calmed down/.test(document.querySelector('#y-result').textContent) && /late/i.test(document.querySelector('#y-result').textContent)")
    ans = page.inner_text("#y-result .y-answer")
    check("Young Minds lab: late monsoon uses the real API value", "13 months" in ans and "3 months" in ans, ans)
    page.click("#y-help-open")
    page.locator(".y-help-qs button", has_text="I feel sick").click()
    check("Young Minds helper refuses health questions", "parent, a teacher or a doctor" in page.inner_text(".y-help-log"))
    goto(page, "young-quiz")
    page.wait_for_selector(".y-answer-btn")
    for _ in range(5):
        page.locator(".y-answer-btn").first.click()  # correct answers are listed first in this quiz
        page.click("#y-next")
    check("Young Minds quiz completes", "You got" in page.inner_text("#y-quiz"))
    status = api(page, "POST", "/me/saved", {"name": "x", "district": "cbe", "disease": "dengue", "scenario": "baseline"})[0]
    check("server refuses saving for Young Minds (403)", status == 403)
    w.allow = (403,)
    page.screenshot(path=str(SHOTS / "check_young_quiz.png"), full_page=True)
    check("Young Minds had no errors", not [x for x in w.take() if "403" not in x])
    page.close()


def expiry_check(browser):
    page = browser.new_page(viewport=VIEWPORTS["desktop"])
    sign_in(page, "viewer", port=EXPIRY_PORT)
    t0 = time.time()
    page.wait_for_selector("#login-form", timeout=100000)
    check("session expiry returns to sign-in (1-minute session)", "session expired" in page.inner_text("#view").lower(), f"after {time.time() - t0:.0f} s idle")
    page.close()


def lockout_check(browser):
    page = browser.new_page(viewport=VIEWPORTS["desktop"])
    sign_in(page, "analyst", "wrong-password", wait=False)
    page.wait_for_selector("#login-error:not([hidden])")
    check("wrong password shows an error", "incorrect" in page.inner_text("#login-error"))
    msg = ""
    for _ in range(4):
        page.fill("#login-pass", "wrong-again")
        page.click("#login-submit")
        page.wait_for_timeout(400)
        msg = page.inner_text("#login-error")
    check("5 wrong passwords lock sign-in", "Too many wrong attempts" in msg, msg)
    page.close()


def main():
    for d in (SHOTS, DOWNLOADS):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
    tmp = Path(tempfile.mkdtemp())
    servers = [start_server(PORT, tmp), start_server(EXPIRY_PORT, tmp, EPIMETRICS_SESSION_MINUTES="1", EPIMETRICS_WARM="0")]
    try:
        wait_models(PORT)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            pre = browser.new_page()
            sign_in(pre, "admin")
            before_usage = api(pre, "GET", "/admin/usage")[1]
            pre.close()
            sweep(browser)
            compare_flow(browser)
            drill_flow(browser)
            saved_flow(browser)
            comment_pdf_flow(browser)
            viewer_limits(browser)
            mask_checks(browser)
            assistant_checks(browser)
            young_checks(browser)
            admin_flow(browser, before_usage)
            map_checks(p)
            expiry_check(browser)
            lockout_check(browser)  # last: it locks the analyst account for 30 s
            browser.close()
    finally:
        for s in servers:
            s.terminate()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    for name, _, detail in failed:
        print(f"  FAIL {name}: {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
