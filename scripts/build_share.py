#!/usr/bin/env python3
"""Render the weekly briefing card ("This week" on the home page) to site/share/this-week.png.

The image is made by the site's own code (sharecard.js: App.ShareCard.weeklyPng), in headless Chromium,
from the data files in site/data, so the saved image and the home page's button always agree. The pages
are served from the local folder under the live site's address, so the card prints the real URL.

The refresh workflow runs this after scripts/refresh.py. If anything fails, the error is logged (and a
::warning:: in Actions), the previous image is kept and the script exits 0.

Needs Playwright with Chromium:  pip install playwright && python -m playwright install chromium
Usage: python scripts/build_share.py [--site-dir site] [--out site/share/this-week.png] [--channel chrome]
"""
from __future__ import annotations

import argparse
import base64
import logging
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

ROOT = Path(__file__).resolve().parents[1]
SITE_URL = "https://alisterjoyce.github.io/vic-election-tracker/"
log = logging.getLogger("build_share")


def warn_ci(message: str) -> None:
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::warning::{message}")


def render(site_dir: Path, channel: str | None) -> bytes:
    from playwright.sync_api import sync_playwright
    prefix = urlparse(SITE_URL).path

    def serve(route):
        path = unquote(urlparse(route.request.url).path)[len(prefix):] or "index.html"
        if path.endswith("/"):
            path += "index.html"
        file = (site_dir / path).resolve()
        if site_dir.resolve() not in file.parents or not file.is_file():
            return route.fulfill(status=404, body="not found")
        route.fulfill(status=200, body=file.read_bytes(),
                      content_type=mimetypes.guess_type(file.name)[0] or "application/octet-stream")

    with sync_playwright() as p:
        browser = p.chromium.launch(**({"channel": channel} if channel else {}))
        try:
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme="light",
                                      service_workers="block", timezone_id="Australia/Melbourne", locale="en-AU")
            ctx.route(f"{SITE_URL}**", serve)
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(SITE_URL + "index.html", wait_until="load")
            page.wait_for_function("window.App && App.ShareCard && App.ShareCard.weeklyPng", timeout=30000)
            data_url = page.evaluate("App.ShareCard.weeklyPng()")
            if errors:
                log.warning("Page errors: %s", "; ".join(errors[:3]))
        finally:
            browser.close()
    head, _, b64 = data_url.partition(",")
    if not head.startswith("data:image/png"):
        raise RuntimeError(f"unexpected image data: {head[:40]}")
    png = base64.b64decode(b64)
    if len(png) < 10_000:
        raise RuntimeError(f"image suspiciously small ({len(png)} bytes)")
    return png


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--site-dir", type=Path, default=ROOT / "site")
    ap.add_argument("--out", type=Path, default=None, help="default: <site-dir>/share/this-week.png")
    ap.add_argument("--channel", default=None, help="a Chromium channel such as 'chrome' (default: Playwright's Chromium)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out = args.out or args.site_dir / "share" / "this-week.png"
    try:
        png = render(args.site_dir, args.channel)
    except Exception as exc:  # noqa: BLE001 - keep the last image, report, exit 0
        log.error("This-week image not made, previous one kept: %s", exc)
        warn_ci(f"This-week image not made, previous one kept: {exc}")
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and out.read_bytes() == png:
        log.info("%s unchanged", out)
        return 0
    out.write_bytes(png)
    log.info("Wrote %s (%d KB)", out, len(png) // 1024)
    return 0


if __name__ == "__main__":
    sys.exit(main())
