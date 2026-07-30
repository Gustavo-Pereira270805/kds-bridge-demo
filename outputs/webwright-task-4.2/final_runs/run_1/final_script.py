"""
Task 4.2: verify aria-pressed updates on period button click.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

LOG_PATH = Path(__file__).parent / "final_script_log.txt"
SHOTS = Path(__file__).parent / "screenshots"

RANGES = ["today", "yesterday", "week", "month"]
LABELS = {"today": "Hoje", "yesterday": "Ontem", "week": "Últimos 7 dias", "month": "Últimos 30 dias"}


def log(msg: str) -> None:
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(msg + "\n")
    print(msg)


def snapshot_aria_state(page) -> dict:
    return page.evaluate(
        """() => {
            const out = {};
            document.querySelectorAll('.period-btn').forEach(b => {
                out[b.dataset.range] = b.getAttribute('aria-pressed');
            });
            return out;
        }"""
    )


def main() -> int:
    if LOG_PATH.exists():
        LOG_PATH.unlink()
    SHOTS.mkdir(parents=True, exist_ok=True)

    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 1800})
        page = context.new_page()

        page.on(
            "console",
            lambda msg: errors.append(f"{msg.type}: {msg.text}")
            if msg.type in ("error",)
            else None,
        )
        page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))

        page.goto("http://localhost:3000/dashboard", wait_until="domcontentloaded")
        page.wait_for_selector(".period-btn", timeout=10000)
        page.wait_for_timeout(1500)

        log("step 1 action: initial state check")
        initial = snapshot_aria_state(page)
        log(f"  state: {json.dumps(initial, ensure_ascii=False)}")
        page.screenshot(path=str(SHOTS / "01_initial.png"))

        for r in RANGES:
            expected = "true" if r == "today" else "false"
            actual = initial.get(r)
            if actual != expected:
                log(f"  FAIL: {r} expected {expected}, got {actual}")
                errors.append(f"initial {r}={actual} (expected {expected})")

        step = 1
        for target in ["yesterday", "week", "month", "today"]:
            step += 1
            log(f"step {step} action: click {LABELS[target]}")
            page.click(f'.period-btn[data-range="{target}"]')
            page.wait_for_timeout(600)
            state = snapshot_aria_state(page)
            log(f"  state: {json.dumps(state, ensure_ascii=False)}")
            page.screenshot(path=str(SHOTS / f"{step - 1:02d}_click_{target}.png"))
            for r in RANGES:
                expected = "true" if r == target else "false"
                actual = state.get(r)
                if actual != expected:
                    log(f"  FAIL: {r} expected {expected}, got {actual}")
                    errors.append(f"after click {target}: {r}={actual} (expected {expected})")

        log("step 99 action: keyboard activation test")
        page.focus('.period-btn[data-range="yesterday"]')
        page.keyboard.press("Space")
        page.wait_for_timeout(600)
        kbd_state = snapshot_aria_state(page)
        log(f"  state: {json.dumps(kbd_state, ensure_ascii=False)}")
        page.screenshot(path=str(SHOTS / "06_keyboard.png"))
        for r in RANGES:
            expected = "true" if r == "yesterday" else "false"
            actual = kbd_state.get(r)
            if actual != expected:
                log(f"  FAIL: {r} expected {expected}, got {actual}")
                errors.append(f"after keyboard: {r}={actual} (expected {expected})")

        browser.close()

    if errors:
        log(f"console errors: {len(errors)}")
        for e in errors:
            log(f"  {e}")
        log("RESULT: FAIL")
        return 1

    log("RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
