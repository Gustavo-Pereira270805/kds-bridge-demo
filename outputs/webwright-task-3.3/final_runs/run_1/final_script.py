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


async def section_anchor_top(page, sec_id: str) -> int:
    return round(await page.evaluate(
        f"() => document.getElementById('{sec_id}').getBoundingClientRect().top"
    ))


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.firefox.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()

        console_errors = []
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: console_errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)

        await page.goto("http://localhost:3000/dashboard", wait_until="domcontentloaded")
        await page.wait_for_selector("aside.side-nav", timeout=10000)
        await asyncio.sleep(2.0)

        side_nav = page.locator("aside.side-nav")
        collapsed_width = await side_nav.evaluate("el => el.getBoundingClientRect().width")
        log(1, f"/dashboard loaded; side nav collapsed width={collapsed_width}px")

        # Click each of the 3 sections — then move mouse away + blur nav so it collapses to 64px
        for i, sec_id in enumerate(["overview", "demand", "performance"]):
            link = page.locator(f".side-nav a[data-section='{sec_id}']")
            await link.click()
            await asyncio.sleep(1.2)
            # Move mouse far from nav and blur any focused nav link
            await page.mouse.move(1800, 540)
            await page.evaluate("document.activeElement && document.activeElement.blur()")
            await asyncio.sleep(0.8)
            top = await section_anchor_top(page, sec_id)
            active = [a for a in await get_active(page) if a["current"] == "true"]
            nav_w = await side_nav.evaluate("el => el.getBoundingClientRect().width")
            log(2 + i, f"clicked #{sec_id} link -> nav_w={nav_w}px, section top={top}px, active={active}")
            await page.screenshot(
                path=str(SCREENSHOTS / f"final_execution_{i+1}_section_{sec_id}.png"),
                full_page=True,
            )

        # Hover-expand test
        await page.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(0.5)
        await side_nav.hover()
        await asyncio.sleep(0.6)
        expanded_width = await side_nav.evaluate("el => el.getBoundingClientRect().width")
        label_opacity_hover = await side_nav.locator(".label").first.evaluate(
            "el => getComputedStyle(el).opacity"
        )
        log(5, f"hovered side nav -> expanded width={expanded_width}px, first label opacity={label_opacity_hover}")
        await page.screenshot(path=str(SCREENSHOTS / "final_execution_4_hover_expanded.png"), full_page=True)

        log(6, f"console errors captured: {console_errors}")

        summary = {
            "collapsed_width": collapsed_width,
            "expanded_width": expanded_width,
            "label_opacity_hover": label_opacity_hover,
            "console_errors": console_errors,
        }
        with LOG.open("a") as f:
            f.write("\nFINAL_RESPONSE: " + repr(summary) + "\n")

        await browser.close()


asyncio.run(main())
