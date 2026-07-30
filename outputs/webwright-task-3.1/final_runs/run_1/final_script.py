import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

URL = "http://localhost:3000/dashboard"
SCREENSHOT_DIR = Path("C:/Users/Milena/OneDrive/Documentos/programas/KDS_demo/outputs/webwright-task-3.1/final_runs/run_1/screenshots")
LOG_PATH = Path("C:/Users/Milena/OneDrive/Documentos/programas/KDS_demo/outputs/webwright-task-3.1/final_runs/run_1/final_script_log.txt")
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

EXPECTED_SECTIONS = ["top", "overview", "demand", "sla", "diagnosis", "performance"]
EXPECTED_LABELS = ["Topo", "Visão Geral", "Demanda", "SLA e Tempos", "Diagnóstico", "Performance"]


def log(message: str) -> None:
    print(message)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(message + "\n")


async def main() -> None:
    LOG_PATH.write_text("", encoding="utf-8")
    async with async_playwright() as p:
        browser = await p.firefox.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        console_errors: list[str] = []
        page.on("console", lambda msg: console_errors.append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(f"pageerror: {err}"))

        log("step 1: navigating to /dashboard")
        await page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_selector("#sideNav", state="attached", timeout=10000)
        await page.wait_for_timeout(2000)

        log("step 2: capturing initial collapsed side nav")
        await page.screenshot(path=str(SCREENSHOT_DIR / "01_initial.png"), full_page=False)

        log("step 3: hovering over side nav to expand it")
        await page.locator("#sideNav").hover()
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(SCREENSHOT_DIR / "02_hover_expanded.png"), full_page=False)

        log("step 4: checking side nav structure")
        nav_exists = await page.locator("aside.side-nav#sideNav").count()
        log(f"  side nav count: {nav_exists}")

        list_items = page.locator("#sideNav ul li")
        item_count = await list_items.count()
        log(f"  list item count: {item_count}")

        sections = []
        for i in range(item_count):
            anchor = list_items.nth(i).locator("a")
            data_section = await anchor.get_attribute("data-section")
            aria_current = await anchor.get_attribute("aria-current")
            svg_count = await list_items.nth(i).locator("svg.icon").count()
            label = await list_items.nth(i).locator("span.label").inner_text()
            sections.append({
                "data_section": data_section,
                "aria_current": aria_current,
                "svg_count": svg_count,
                "label": label,
            })

        log(f"  sections: {sections}")

        log("step 5: verifying data-section values")
        actual_sections = [s["data_section"] for s in sections]
        log(f"  actual: {actual_sections}")
        log(f"  expected: {EXPECTED_SECTIONS}")
        assert actual_sections == EXPECTED_SECTIONS, f"mismatch: {actual_sections}"

        log("step 6: verifying aria-current values")
        aria_currents = [s["aria_current"] for s in sections]
        assert aria_currents == ["false"] * 6, f"aria-current mismatch: {aria_currents}"

        log("step 7: verifying each li has exactly one svg.icon")
        svg_counts = [s["svg_count"] for s in sections]
        assert svg_counts == [1] * 6, f"svg count mismatch: {svg_counts}"

        log("step 8: verifying labels")
        actual_labels = [s["label"] for s in sections]
        log(f"  actual: {actual_labels}")
        log(f"  expected: {EXPECTED_LABELS}")
        assert actual_labels == EXPECTED_LABELS, f"label mismatch: {actual_labels}"

        log("step 9: verifying SVG viewBox is 24x24")
        first_svg = page.locator("#sideNav svg.icon").first
        viewbox = await first_svg.get_attribute("viewBox")
        log(f"  first svg viewBox: {viewbox}")
        assert viewbox == "0 0 24 24", f"unexpected viewBox: {viewbox}"

        log("step 10: clicking each nav link to verify anchor target")
        for s in EXPECTED_SECTIONS:
            target = page.locator(f"#{s}")
            count = await target.count()
            log(f"  target #{s}: count={count}")
            assert count >= 1, f"no element with id={s}"

        log("step 11: console errors")
        log(f"  console errors: {console_errors}")
        assert len(console_errors) == 0, f"console errors found: {console_errors}"

        log("step 12: capturing page after scroll to demand section")
        await page.locator("a[href='#demand']").click()
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(SCREENSHOT_DIR / "03_scrolled_demand.png"), full_page=False)

        log("DONE: all 6 nav items verified, all anchors resolve, no console errors")
        await browser.close()


asyncio.run(main())
