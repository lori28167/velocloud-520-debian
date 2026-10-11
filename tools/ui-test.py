#!/usr/bin/env python3
# Logs into Cockpit on the QEMU test VM (https://127.0.0.1:9443), opens the
# Router page, visits every tab in English and Italian (screenshots in
# out/ui/), then runs a full change: toggle a firewall option, Apply, wait for
# the confirmation banner, Keep changes; and adds/removes a Wi-Fi user.
# Prints every console error, page error and HTTP error.
import sys
from playwright.sync_api import sync_playwright

URL = "https://127.0.0.1:9443"
USER, PW = "root", sys.argv[1]
OUT = "out/ui"
errors = []


def watch(page, tag):
    page.on("console", lambda m: m.type in ("error", "warning") and errors.append(f"[{tag}] console {m.type}: {m.text}"))
    page.on("pageerror", lambda e: errors.append(f"[{tag}] page error: {e}"))
    page.on("response", lambda r: r.status >= 400 and errors.append(f"[{tag}] HTTP {r.status} {r.url}"))


def login(ctx, tag):
    page = ctx.new_page()
    watch(page, tag)
    page.goto(URL + "/")
    page.fill("#login-user-input", USER)
    page.fill("#login-password-input", PW)
    page.click("#login-button")
    page.wait_for_selector("#host-apps, nav", timeout=30000)
    page.goto(URL + "/cockpit/@localhost/velocloud/index.html")
    page.wait_for_selector(".vc-tabs", timeout=30000)
    page.wait_for_timeout(3500)
    return page


def tab(page, i):
    page.locator(".vc-tabs button").nth(i).click()
    page.wait_for_timeout(800)


with sync_playwright() as p:
    b = p.chromium.launch()
    for lang in ("en-US", "it-IT"):
        ctx = b.new_context(ignore_https_errors=True, locale=lang, viewport={"width": 1366, "height": 900},
                            extra_http_headers={"Accept-Language": lang})
        page = login(ctx, lang)
        for i in range(page.locator(".vc-tabs button").count()):
            tab(page, i)
            name = page.locator(".vc-tabs button").nth(i).inner_text()
            page.screenshot(path=f"{OUT}/{lang}-{i}-{name}.png", full_page=True)
        print(f"{lang}: tabs={page.locator('.vc-tabs button').all_inner_texts()}")
        ctx.close()

    # full apply + confirm flow, Wi-Fi user add/remove (English)
    ctx = b.new_context(ignore_https_errors=True, locale="en-US", viewport={"width": 1366, "height": 900})
    page = login(ctx, "flow")
    tab(page, 3)
    page.get_by_label("SSH").click()	# toggle: always a real change
    page.wait_for_timeout(300)
    page.locator(".vc-bar button", has_text="Apply").click()
    page.wait_for_selector(".vc-alert.warn", timeout=60000)
    banner = page.locator(".vc-alert.warn").inner_text()
    page.screenshot(path=f"{OUT}/flow-pending.png")
    page.locator(".vc-alert.warn button", has_text="Keep changes").click()
    page.wait_for_selector(".vc-alert.warn", state="detached", timeout=30000)
    page.wait_for_timeout(1000)
    print("apply flow: banner =", banner.splitlines()[0][:90], "| kept, notice =",
          page.locator(".vc-alert.info").first.inner_text()[:40] if page.locator(".vc-alert.info").count() else None)
    tab(page, 2)
    page.wait_for_timeout(1500)
    page.fill("[data-key=nu-name]", "tester")
    page.fill("[data-key=nu-pw]", "password-123")
    page.fill("[data-key=nu-pw2]", "password-123")
    page.locator("button", has_text="Add user").last.click()
    page.wait_for_timeout(3000)
    users = page.locator(".vc-card", has_text="Users").locator("tbody tr").all_inner_texts()
    page.screenshot(path=f"{OUT}/flow-users.png", full_page=True)
    page.on("dialog", lambda d: d.accept())
    page.locator(".vc-card", has_text="Users").locator("button", has_text="Remove").first.click()
    page.wait_for_timeout(3000)
    after = page.locator(".vc-card", has_text="Users").locator("tbody tr").all_inner_texts()
    print("wifi users: after add =", users, "| after remove =", after)
    tab(page, 4)
    page.get_by_label("Turn off at night").click()
    page.wait_for_timeout(500)
    times = page.locator("input[type=time]").count()
    page.locator(".vc-swatch").nth(2).click()
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/flow-led.png", full_page=True)
    print("led: time fields =", times, "| apply bar =", page.locator(".vc-bar").count())
    page.locator(".vc-bar button", has_text="Discard").click()
    ctx.close()
    b.close()

print("errors:" if errors else "no console/page/HTTP errors")
for e in errors:
    print(" ", e)
