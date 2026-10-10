#!/usr/bin/env python3
# First login on a fresh release image in the QEMU test VM: Cockpit with
# root / velocloud must force a new password, then the Router page must load.
import sys
from playwright.sync_api import sync_playwright

URL = "https://127.0.0.1:9443"
NEW = sys.argv[1]
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(ignore_https_errors=True, locale="en-US").new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL + "/")
    page.fill("#login-user-input", "root")
    page.fill("#login-password-input", "velocloud")
    page.click("#login-button")
    prompts = []
    for _ in range(6):
        page.wait_for_selector("#conversation-input:visible, #host-apps, nav", timeout=30000)
        if not page.locator("#conversation-input").is_visible():
            break
        text = page.locator("#conversation-prompt").inner_text().strip()
        prompts.append(text)
        page.fill("#conversation-input", "velocloud" if "urrent" in text else NEW)
        page.click("#login-button")
        page.wait_for_timeout(1500)
    print("password prompts:", prompts)
    page.goto(URL + "/cockpit/@localhost/velocloud/index.html")
    page.wait_for_selector(".vc-tabs", timeout=30000)
    page.wait_for_timeout(3000)
    print("router page tabs:", page.locator(".vc-tabs button").all_inner_texts())
    page.screenshot(path="out/ui/firstboot-router.png", full_page=True)
    b.close()
print("page errors:", errors or "none")
