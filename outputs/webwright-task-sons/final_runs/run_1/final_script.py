import asyncio
import os
import json

from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
RUN = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(RUN, "screenshots")
os.makedirs(SHOTS, exist_ok=True)

LOG = os.path.join(RUN, "final_script_log.txt")
STEPS = []


def step(n, action, detail=""):
    line = f"step {n} action: {action}" + (f" | {detail}" if detail else "")
    STEPS.append(line)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)


async def main():
    if os.path.exists(LOG):
        os.remove(LOG)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, channel="chrome")
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            permissions=["notifications"],
        )

        # ---------- CP1: quente sem erros ----------
        page = await context.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: console_errors.append(f"reqfail: {r.url}"))
        page.on("response", lambda r: console_errors.append(f"HTTP{r.status}: {r.url}") if r.status >= 400 else None)

        await page.goto(f"{BASE}/cozinha-quente", wait_until="networkidle")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(SHOTS, "final_execution_01_quente_carregada.png"))

        # CP3: motor exposto e 4 sons tocam
        result = await page.evaluate("""
            () => {
                const out = { funcs: {}, sounds: [] };
                const names = ['playNormalAlert', 'playUrgentAlert', 'playStockoutAlert', 'playCrossCancelAlert'];
                for (const n of names) out.funcs[n] = typeof window[n] === 'function';
                const Ctx = window.AudioContext || window.webkitAudioContext;
                out.hasAudio = !!Ctx;
                for (const n of names) {
                    try { window[n](); out.sounds.push(n + ':ok'); }
                    catch (e) { out.sounds.push(n + ':ERR:' + e.message); }
                }
                return out;
            }
        """)
        step(1, "CP3 motor exposto", json.dumps(result, ensure_ascii=False))
        await page.wait_for_timeout(800)
        await page.screenshot(path=os.path.join(SHOTS, "final_execution_02_quente_4sons.png"))

        quente_failures = [e for e in console_errors if "GCM" not in e and "registration" not in e.lower()]
        step(2, "CP1 console quente", f"erros={len(quente_failures)} {json.dumps(quente_failures[:5], ensure_ascii=False)}")
        if quente_failures:
            await page.screenshot(path=os.path.join(SHOTS, "final_execution_03_quente_erros.png"))
        await page.close()

        # ---------- CP2: fria sem erros ----------
        page2 = await context.new_page()
        console_errors2 = []
        page2.on("console", lambda m: console_errors2.append(m.text) if m.type == "error" else None)
        page2.on("pageerror", lambda e: console_errors2.append(f"pageerror: {e}"))
        page2.on("response", lambda r: console_errors2.append(f"HTTP{r.status}: {r.url}") if r.status >= 400 else None)

        await page2.goto(f"{BASE}/cozinha-fria", wait_until="networkidle")
        await page2.wait_for_timeout(1500)
        await page2.screenshot(path=os.path.join(SHOTS, "final_execution_04_fria_carregada.png"))

        result2 = await page2.evaluate("""
            () => {
                const out = { funcs: {}, sounds: [] };
                const names = ['playNormalAlert', 'playUrgentAlert', 'playStockoutAlert', 'playCrossCancelAlert'];
                for (const n of names) out.funcs[n] = typeof window[n] === 'function';
                for (const n of names) {
                    try { window[n](); out.sounds.push(n + ':ok'); }
                    catch (e) { out.sounds.push(n + ':ERR:' + e.message); }
                }
                return out;
            }
        """)
        step(3, "CP3 motor na fria", json.dumps(result2, ensure_ascii=False))
        fria_failures = [e for e in console_errors2 if "GCM" not in e and "registration" not in e.lower()]
        step(4, "CP2 console fria", f"erros={len(fria_failures)} {json.dumps(fria_failures[:5], ensure_ascii=False)}")
        await page2.close()

        # ---------- CP4: kiosk (sem gesto, alerta pendente -> gesto real) ----------
        page3 = await context.new_page()
        kiosk_log = []
        page3.on("console", lambda m: kiosk_log.append(f"{m.type}: {m.text}") if m.type in ("error", "warn", "log") else None)
        await page3.goto(f"{BASE}/cozinha-quente", wait_until="networkidle")

        # Sem nenhum gesto: dispara o alerta via socket handler direto
        await page3.evaluate("window.playNormalAlert()")
        await page3.wait_for_timeout(1200)
        await page3.screenshot(path=os.path.join(SHOTS, "final_execution_05_kiosk_antes_gesto.png"))

        # Gesto real do usuário (Playwright dispara evento trusted)
        await page3.mouse.click(400, 400)
        await page3.wait_for_timeout(1200)
        await page3.screenshot(path=os.path.join(SHOTS, "final_execution_06_kiosk_apos_gesto.png"))
        kiosk_lines = [l for l in kiosk_log if "KDS sons" in l or "blocked" in l.lower() or "autoplay" in l.lower()]
        step(5, "CP4 kiosk", f"console={json.dumps(kiosk_lines[:5], ensure_ascii=False)}")
        await page3.close()

        # ---------- CP5: sem CDN do Tone ----------
        html_quente = (await (await context.request.get(f"{BASE}/cozinha-quente")).text())
        html_fria = (await (await context.request.get(f"{BASE}/cozinha-fria")).text())
        tone_refs = []
        for name, html in (("quente", html_quente), ("fria", html_fria)):
            if "cdnjs.cloudflare.com/ajax/libs/tone" in html:
                tone_refs.append(name)
        step(6, "CP5 sem CDN Tone.js", f"telas_com_tone={tone_refs or 'nenhuma'}")

        await browser.close()

    step(7, "fim", f"KDS sons: verificação concluída — erros_quente={len(quente_failures)} erros_fria={len(fria_failures)} tone_cdn={tone_refs or 'nenhuma'}")


if __name__ == "__main__":
    asyncio.run(main())
