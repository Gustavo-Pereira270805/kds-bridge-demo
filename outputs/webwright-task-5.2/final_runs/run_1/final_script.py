"""Verify Task 5.2: PALETTE + applyChartDefaults in dashboard.html."""
import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright

RUN_ID = 1
URL = "http://127.0.0.1:3000/dashboard"
LOG_PATH = Path(__file__).parent / "final_script_log.txt"
SCREENS = Path(__file__).parent / "screenshots"
SCREENS.mkdir(parents=True, exist_ok=True)


def log(line: str) -> None:
    print(line)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


async def main() -> int:
    LOG_PATH.write_text("", encoding="utf-8")
    log("step 0 params: url=" + URL)

    async with async_playwright() as p:
        browser = await p.firefox.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        console_msgs = []
        page_errors = []
        page.on("console", lambda msg: console_msgs.append((msg.type, msg.text)))
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        await page.goto(URL, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(4000)  # let Chart.js + applyChartDefaults + data load settle
        log("step 1 action: navigated to /dashboard")

        # CP1: PALETTE has 11 keys (top-level const in non-module script is script-global, not on window)
        palette = await page.evaluate("() => typeof PALETTE !== 'undefined' ? Object.keys(PALETTE) : null")
        log(f"step 2 palette_keys: {json.dumps(palette)}")
        assert palette is not None and len(palette) == 11, f"CP1 FAIL: PALETTE keys = {palette}"

        # CP2: SERIES_COLORS is an array of 7
        series = await page.evaluate("() => Array.isArray(SERIES_COLORS) ? SERIES_COLORS.length : null")
        log(f"step 3 series_count: {series}")
        assert series == 7, f"CP2 FAIL: SERIES_COLORS length = {series}"

        # CP3: Chart is defined
        chart_defined = await page.evaluate("() => typeof window.Chart !== 'undefined'")
        log(f"step 4 chart_defined: {chart_defined}")
        assert chart_defined, "CP3 FAIL: Chart not defined"

        # CP4: Chart.defaults.font.family configured
        font_family = await page.evaluate("() => window.Chart.defaults.font.family")
        font_size = await page.evaluate("() => window.Chart.defaults.font.size")
        log(f"step 5 chart_font: family={font_family!r} size={font_size}")
        assert "Inter" in font_family, f"CP4 FAIL: font family = {font_family!r}"

        # Check page rendered KPI content
        body_text = await page.evaluate("() => document.body.innerText.length")
        kpi_count = await page.evaluate("() => document.querySelectorAll('.kpi-card').length")
        log(f"step 7 body_text_length: {body_text} kpi_count: {kpi_count}")
        assert body_text > 100, f"CP6 FAIL: body text length = {body_text}"
        assert kpi_count >= 8, f"CP6 FAIL: KPI card count = {kpi_count}"

        # Take screenshot to verify no visual regression
        await page.screenshot(path=str(SCREENS / f"final_execution_1_dashboard_loaded.png"))
        log("step 6 screenshot: dashboard loaded")

        # CP5: 0 console errors
        errors = [m for m in console_msgs if m[0] == "error"]
        log(f"step 8 console_errors: {errors}")
        log(f"step 9 page_errors: {page_errors}")
        assert len(errors) == 0, f"CP5 FAIL: console errors = {errors}"
        assert len(page_errors) == 0, f"CP5 FAIL: page errors = {page_errors}"

        # Sample some PALETTE values to confirm CSS vars resolved
        sample = await page.evaluate("""() => ({
            primary: PALETTE.primary,
            primaryTint: PALETTE.primaryTint,
            accentWarm: PALETTE.accentWarm,
            danger: PALETTE.danger,
            textMuted: PALETTE.textMuted,
        })""")
        log(f"step 10 palette_sample: {json.dumps(sample)}")
        for k, v in sample.items():
            assert v and v.strip(), f"PALETTE.{k} is empty (CSS var not resolved)"

        log("ALL CHECKS PASSED")
        await browser.close()
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
