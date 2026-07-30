import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

RUN_DIR = Path(__file__).parent
SCREENSHOTS = RUN_DIR / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
LOG = RUN_DIR / "final_script_log.txt"
LOG.write_text("")


def log(step: int, msg: str) -> None:
    line = f"step {step} action: {msg}\n"
    LOG.open("a").write(line)
    print(line, end="")


async def get_active(page):
    return await page.evaluate(
        "() => Array.from(document.querySelectorAll('.side-nav a[data-section]'))"
        ".map(a => ({ id: a.getAttribute('data-section'), current: a.getAttribute('aria-current') }))"
    )


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.firefox.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        console_errors = []
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: console_errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)

        await page.goto("http://localhost:3000/dashboard", wait_until="domcontentloaded")
        await page.wait_for_selector("aside.side-nav", timeout=10000)
        await asyncio.sleep(2.0)
        await page.screenshot(path=str(SCREENSHOTS / "final_execution_1_load.png"))
        log(1, "open /dashboard; side nav present")

        side_nav = page.locator("aside.side-nav")
        collapsed_width = await side_nav.evaluate("el => el.getBoundingClientRect().width")
        label_opacity_initial = await side_nav.locator(".label").first.evaluate("el => getComputedStyle(el).opacity")
        log(2, f"side nav collapsed width={collapsed_width}px, first label opacity={label_opacity_initial}")
        await page.screenshot(path=str(SCREENSHOTS / "final_execution_2_collapsed.png"))

        await side_nav.hover()
        await asyncio.sleep(0.6)
        expanded_width = await side_nav.evaluate("el => el.getBoundingClientRect().width")
        label_opacity_hover = await side_nav.locator(".label").first.evaluate("el => getComputedStyle(el).opacity")
        log(3, f"side nav hovered width={expanded_width}px, first label opacity={label_opacity_hover}")
        await page.screenshot(path=str(SCREENSHOTS / "final_execution_3_hover_expanded.png"))

        await page.mouse.move(0, 0)
        await asyncio.sleep(0.6)

        active_at_load = await get_active(page)
        log(4, f"active at load: {[a for a in active_at_load if a['current']=='true']}")

        sections = ["overview", "demand", "sla", "diagnosis", "performance"]
        for i, sec_id in enumerate(sections):
            await page.evaluate(
                f"document.getElementById('{sec_id}').scrollIntoView({{behavior:'instant', block:'center'}})"
            )
            await asyncio.sleep(0.9)
            active = await get_active(page)
            current = [a for a in active if a["current"] == "true"]
            log(5 + i, f"scrolled to #{sec_id} center -> active={current}")
        await page.screenshot(path=str(SCREENSHOTS / "final_execution_4_after_scrolls.png"))

        await page.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(0.5)

        click_results = []
        for i, sec_id in enumerate(sections[:3]):
            link = page.locator(f".side-nav a[data-section='{sec_id}']")
            await link.click()
            await asyncio.sleep(1.0)
            y = await page.evaluate("() => window.scrollY")
            top = await page.evaluate(f"() => document.getElementById('{sec_id}').getBoundingClientRect().top")
            active = [a for a in await get_active(page) if a["current"] == "true"]
            click_results.append((sec_id, y, round(top), active))
            log(10 + i, f"clicked #{sec_id} -> scrollY={y}, section top={round(top)}px, active={active}")
            await page.screenshot(path=str(SCREENSHOTS / f"final_execution_5_click_{sec_id}.png"))

        log(13, f"console errors captured: {console_errors}")

        summary = {
            "collapsed_width": collapsed_width,
            "expanded_width": expanded_width,
            "label_opacity_initial": label_opacity_initial,
            "label_opacity_hover": label_opacity_hover,
            "active_at_load": [a for a in active_at_load if a["current"] == "true"],
            "click_results": click_results,
            "console_errors": console_errors,
        }
        with LOG.open("a") as f:
            f.write("\nFINAL_RESPONSE: " + repr(summary) + "\n")

        await browser.close()


asyncio.run(main())
