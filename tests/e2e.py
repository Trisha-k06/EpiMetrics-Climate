"""End-to-end test of the website and API in a real browser (Playwright + Chromium).

    python tests/e2e.py            # starts its own servers on ports 8765 and 8766

Fails on any console error, page error or failed request during the screen sweep, and on sideways
scrolling. Screenshots go to tests/screenshots/, downloads to tests/downloads/.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "tests" / "screenshots"
DOWNLOADS = ROOT / "tests" / "downloads"
PORT, EXPIRY_PORT = 8765, 8766
ROUTES = ["overview", "simulator", "recovery", "episodes", "explorer", "models", "validation", "report", "technology", "platform"]
PASSWORDS = {"viewer": "viewer-demo-2026", "analyst": "analyst-demo-2026", "admin": "admin-demo-2026"}
VIEWPORTS = {"desktop": {"width": 1440, "height": 900}, "phone": {"width": 390, "height": 844}}

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = ""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{f' — {detail}' if detail else ''}", flush=True)


def start_server(port: int, tmp: Path, **env) -> subprocess.Popen:
    e = {**os.environ, "EPIMETRICS_PORT": str(port), "EPIMETRICS_USERS_FILE": str(tmp / f"users_{port}.json"),
         "EPIMETRICS_AUDIT_FILE": str(tmp / f"audit_{port}.jsonl"), **env}
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
    import json
    for _ in range(240):
        h = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health"))
        if h["models_ready"]:
            return
        time.sleep(0.5)


class Watch:
    """Collects console errors, page errors, failed requests and HTTP errors for one page."""

    def __init__(self, page, allow=(403,)):
        self.items: list[str] = []
        self.allow = allow
        page.on("console", lambda m: m.type == "error" and not self._allowed_console(m.text) and self.items.append(f"console: {m.text}"))
        page.on("pageerror", lambda e: self.items.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: self.items.append(f"requestfailed: {r.url} {r.failure}"))
        page.on("response", lambda r: r.status >= 400 and r.status not in self.allow and self.items.append(f"http {r.status}: {r.url}"))

    def _allowed_console(self, text):
        return any(f"status of {s}" in text for s in self.allow)

    def take(self):
        out, self.items = self.items, []
        return out


def base(port=PORT):
    return f"http://127.0.0.1:{port}/"


def sign_in(page, user, password=None, port=PORT):
    page.goto(base(port))
    page.wait_for_selector("#login-form")
    page.fill("#login-user", user)
    page.fill("#login-pass", password or PASSWORDS[user])
    page.click("#login-submit")


def wait_ready(page, timeout=90000):
    page.wait_for_function("() => !document.querySelector('#view [aria-busy=\"true\"]') && !document.querySelector('#view .skeleton')", timeout=timeout)
    page.wait_for_timeout(700)


def goto(page, route):
    page.evaluate(f"location.hash = '{route}'")
    page.wait_for_function(f"() => location.hash === '#{route}'")
    page.wait_for_timeout(150)
    wait_ready(page)


def overflow(page):
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


def sweep(browser):
    """Every role × every screen × desktop/phone × Day/Night."""
    for role in PASSWORDS:
        for vp_name, vp in VIEWPORTS.items():
            ctx = browser.new_context(viewport=vp, reduced_motion="reduce")
            page = ctx.new_page()
            w = Watch(page, allow=())
            sign_in(page, role)
            page.wait_for_selector(".sidenav a[aria-current=page]", timeout=30000)
            wait_ready(page)
            for theme in ("light", "dark"):
                page.click(f"[data-theme-choice={theme}]")
                for r in ROUTES:
                    goto(page, r)
                    errs = w.take()
                    ov = overflow(page)
                    blocked = page.locator("text=accounts can't open this screen").count() > 0
                    expect_blocked = role == "viewer" and r == "validation"
                    panels = page.locator("#view .state-error").count()
                    page.screenshot(path=str(SHOTS / f"{role}_{vp_name}_{theme}_{r}.png"), full_page=True)
                    ok = not errs and ov <= 0 and blocked == expect_blocked and panels == 0
                    check(f"{role} {vp_name} {theme} #{r}", ok,
                          "; ".join(errs[:3]) + (f" overflow {ov}px" if ov > 0 else "") + (f" {panels} error panels" if panels else "")
                          + (" (blocked as expected)" if expect_blocked and blocked else ""))
            ctx.close()


def auth_checks(browser):
    ctx = browser.new_context(viewport=VIEWPORTS["desktop"])
    page = ctx.new_page()
    sign_in(page, "analyst", "wrong-password")
    page.wait_for_selector("#login-error:not([hidden])")
    check("wrong password shows an error", "incorrect" in page.inner_text("#login-error"), page.inner_text("#login-error"))
    msg = ""
    for _ in range(4):
        page.fill("#login-pass", "wrong-again")
        page.click("#login-submit")
        page.wait_for_timeout(400)
        msg = page.inner_text("#login-error")
    check("5 wrong passwords lock sign-in", "Too many wrong attempts" in msg, msg)
    page.fill("#login-pass", PASSWORDS["analyst"])
    page.click("#login-submit")
    page.wait_for_timeout(500)
    msg = page.inner_text("#login-error")
    check("locked even with the right password", "Try again in" in msg, msg)
    ctx.close()


def viewer_checks(browser):
    ctx = browser.new_context(viewport=VIEWPORTS["desktop"])
    page = ctx.new_page()
    sign_in(page, "viewer")
    page.wait_for_selector(".sidenav a[aria-current=page]")
    check("viewer has no Validation nav item", page.locator(".sidenav a[data-route=validation]").is_hidden())
    goto(page, "validation")
    check("viewer cannot open Validation", page.locator("text=accounts can't open this screen").count() == 1)
    goto(page, "report")
    check("viewer sees no export buttons", page.locator("#rep-pdf, #rep-json, #rep-csv, #rep-print").count() == 0)
    goto(page, "technology")
    check("viewer project PDF button disabled", page.locator("#pdf-export").is_disabled())
    status = page.evaluate("""async () => {
      const t = JSON.parse(sessionStorage.getItem('epimetrics.session.v2')).token;
      const h = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
      const a = await fetch('/api/v1/exports', { method: 'POST', headers: h, body: JSON.stringify({ kind: 'report_pdf' }) });
      const b = await fetch('/api/v1/validation?disease=dengue', { headers: h });
      return [a.status, b.status];
    }""")
    check("server refuses viewer export and validation (403)", status == [403, 403], str(status))
    ctx.close()


def analyst_checks(browser):
    ctx = browser.new_context(viewport=VIEWPORTS["desktop"], accept_downloads=True)
    page = ctx.new_page()
    w = Watch(page)
    sign_in(page, "analyst")
    page.wait_for_selector(".sidenav a[aria-current=page]")
    goto(page, "report")
    for btn, kind in (("#rep-pdf", "report PDF"), ("#rep-json", "JSON"), ("#rep-csv", "CSV")):
        with page.expect_download(timeout=60000) as dl:
            page.click(btn)
        d = dl.value
        path = DOWNLOADS / d.suggested_filename
        d.save_as(path)
        size = path.stat().st_size
        head = path.read_bytes()[:5]
        ok = size > 500 and (kind != "report PDF" or head == b"%PDF-")
        check(f"analyst downloads {kind}", ok, f"{d.suggested_filename}, {size} bytes")
        page.wait_for_timeout(300)
    goto(page, "technology")
    with page.expect_download(timeout=120000) as dl:
        page.click("#pdf-export")
    d = dl.value
    path = DOWNLOADS / d.suggested_filename
    d.save_as(path)
    page.wait_for_function("() => /pages/.test(document.querySelector('#pdf-status').textContent)", timeout=30000)
    status = page.inner_text("#pdf-status")
    check("analyst downloads project PDF", path.stat().st_size > 5000 and path.read_bytes()[:5] == b"%PDF-", f"{path.name}, {path.stat().st_size} bytes; {status}")
    check("export flow had no errors", not w.take())
    ctx.close()


def admin_checks(browser):
    ctx = browser.new_context(viewport=VIEWPORTS["desktop"])
    page = ctx.new_page()
    w = Watch(page)
    sign_in(page, "admin")
    page.wait_for_selector(".sidenav a[aria-current=page]")
    goto(page, "platform")
    page.click("#pf-verify-server")
    page.wait_for_function("() => /match|changed/.test(document.querySelector('#pf-int-status').textContent)", timeout=60000)
    st = page.inner_text("#pf-int-status")
    check("admin: Verify files on the server — all match", "files match" in st and "changed" not in st, st)
    page.click("#pf-validate")
    page.wait_for_function("() => /semantic checks/.test(document.querySelector('#pf-int-status').textContent)", timeout=300000)
    st = page.inner_text("#pf-int-status")
    check("admin: Run validation — 34 PASS", "34 of 34 semantic checks PASS" in st and "All checks pass" in st, st)
    page.click("#pf-verify-browser")
    page.wait_for_function("() => /website files match|changed/.test(document.querySelector('#pf-int-status').textContent)", timeout=120000)
    st = page.inner_text("#pf-int-status")
    check("admin: browser re-check of website files", "website files match" in st, st)
    page.click("#pf-audit-refresh")
    page.wait_for_timeout(800)
    check("admin: audit log lists integrity checks", page.locator(".audit-table td", has_text="integrity_validate").count() >= 1)
    check("admin tools had no errors", not w.take())
    ctx.close()


def mask_checks(browser):
    ctx = browser.new_context(viewport=VIEWPORTS["desktop"])
    page = ctx.new_page()
    w = Watch(page)
    sign_in(page, "analyst")
    page.wait_for_selector(".sidenav a[aria-current=page]")
    goto(page, "simulator")
    page.select_option("#sim-mask", "cases_gap_3m")
    page.wait_for_function("() => /no reported cases/.test(document.querySelector('#sim-view').textContent)", timeout=30000)
    # The chart is drawn on the next animation frame: wait until a case line is split into segments by the gap.
    broken = True
    try:
        page.wait_for_function("() => [...document.querySelectorAll('#sim-cases svg path')].some((p) => (p.getAttribute('d') || '').split('M').length > 2)", timeout=15000)
    except Exception:
        broken = False
    gap_legend = page.locator("#sim-view .swatch-gap").count() > 0
    errs = w.take()
    check("mask 3-month gap: chart shows gaps, no crash", gap_legend and broken and not errs, f"legend={gap_legend} line_breaks={broken} errors={errs[:2]}")
    page.select_option("#sim-mask", "cases_outage_9m")
    page.wait_for_function("() => /Insufficient data/.test(document.querySelector('#sim-kpis').textContent)", timeout=30000)
    check("mask 9-month outage: insufficient data", page.locator("#sim-view", has_text="Insufficient data").count() == 1 and not w.take())
    page.screenshot(path=str(SHOTS / "check_mask_outage.png"), full_page=True)
    page.select_option("#sim-mask", "none")
    wait_ready(page)
    goto(page, "recovery")
    page.select_option("#rec-mask", "cases_outage_9m")
    page.wait_for_timeout(1500)
    check("recovery matrix follows the mask", page.locator(".heat-cell", has_text="insufficient data").count() == 35, f"{page.locator('.heat-cell', has_text='insufficient data').count()} cells")
    page.select_option("#rec-mask", "none")
    page.wait_for_timeout(800)
    ctx.close()


def map_checks(p):
    for label, args in (("WebGL", []), ("2D fallback", ["--disable-webgl", "--disable-3d-apis"])):
        b = p.chromium.launch(args=args)
        page = b.new_page(viewport=VIEWPORTS["desktop"])
        w = Watch(page)
        sign_in(page, "viewer")
        page.wait_for_selector(".sidenav a[aria-current=page]")
        goto(page, "recovery")
        page.wait_for_selector("#rec-map .map-label", timeout=30000)
        has_canvas = page.locator("#rec-map canvas").count() > 0
        has_2d = page.locator("#rec-map svg.map2d").count() > 0
        for layer in ("peak", "flood", "density", "result"):
            page.click(f"[data-layer={layer}]")
            page.wait_for_timeout(300)
        legend = page.inner_text("#rec-map .map-legend")
        page.hover("#rec-map .map-label[data-id=cbe]")
        page.wait_for_timeout(300)
        tip = page.inner_text("#rec-map .map-tip") if page.locator("#rec-map .map-tip").is_visible() else ""
        page.screenshot(path=str(SHOTS / f"check_map_{'webgl' if not args else '2d'}.png"))
        ok = (has_canvas and not has_2d) if not args else (has_2d and not has_canvas)
        check(f"map loads ({label})", ok and "ΔTSR" in legend and not w.take(), f"canvas={has_canvas} svg2d={has_2d}")
        check(f"map hover shows district profile ({label})", "Flood exposure" in tip and "Coimbatore" in tip, tip[:80].replace("\n", " "))
        b.close()


def assistant_checks(browser):
    ctx = browser.new_context(viewport=VIEWPORTS["desktop"])
    page = ctx.new_page()
    w = Watch(page)
    sign_in(page, "viewer")
    page.wait_for_selector(".sidenav a[aria-current=page]")
    wait_ready(page)
    page.click("#as-open")
    cases = [
        ("What is TSR?", "Time to Sustained Recovery"),
        ("Why does recovery take longer here?", "recovery delay"),
        ("Which forecast model is best?", "lowest error"),
        ("How many outbreak episodes?", "602 outbreak episodes"),
        ("what medicine should I take", "can't help with medical questions"),
    ]
    for q, expect in cases:
        n = page.locator(".as-bot").count()
        page.fill("#as-input", q)
        page.press("#as-input", "Enter")
        page.wait_for_function(f"() => document.querySelectorAll('.as-bot').length > {n} && !document.querySelector('.as-typing')", timeout=60000)
        ans = page.locator(".as-bot").last.inner_text()
        check(f"assistant: {q}", expect.lower() in ans.lower(), ans[:110].replace("\n", " "))
    page.screenshot(path=str(SHOTS / "check_assistant.png"))
    check("assistant had no errors", not w.take())
    ctx.close()


def expiry_check(browser):
    ctx = browser.new_context(viewport=VIEWPORTS["desktop"])
    page = ctx.new_page()
    sign_in(page, "viewer", port=EXPIRY_PORT)
    page.wait_for_selector(".sidenav a[aria-current=page]")
    wait_ready(page)
    t0 = time.time()
    page.wait_for_selector("#login-form", timeout=100000)
    text = page.inner_text("#view")
    check("session expiry returns to sign-in (1-minute session)", "session expired" in text.lower(), f"after {time.time() - t0:.0f} s idle")
    ctx.close()


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
            sweep(browser)
            viewer_checks(browser)
            analyst_checks(browser)
            admin_checks(browser)
            mask_checks(browser)
            assistant_checks(browser)
            map_checks(p)
            expiry_check(browser)
            auth_checks(browser)  # last: it locks the analyst account for 30 s
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
