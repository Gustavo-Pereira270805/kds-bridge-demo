import asyncio
import os
import json
import urllib.request

from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
RUN = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(RUN, "screenshots")
os.makedirs(SHOTS, exist_ok=True)

LOG = os.path.join(RUN, "final_script_log.txt")
PROD_QUENTE = "dca2f0d0-bdde-4e20-8c6f-a26034ccc435"
PROD_FRIA = "f0df749b-b08b-4783-963d-65900bbb3a7a"


def step(n, action, detail=""):
    line = f"step {n} action: {action}" + (f" | {detail}" if detail else "")
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)


def criar_demanda(produto, prioridade="normal"):
    body = json.dumps({"product_id": produto, "quantity": 1, "priority": prioridade}).encode()
    req = urllib.request.Request(
        f"{BASE}/api/v1/demands", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


async def main():
    if os.path.exists(LOG):
        os.remove(LOG)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, channel="chrome")
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        page = await context.new_page()
        erros = []
        page.on("pageerror", lambda e: erros.append(f"pageerror: {e}"))
        page.on("console", lambda m: erros.append(f"console[{m.type}]: {m.text}") if m.type in ("error", "warning") else None)
        page.on("requestfailed", lambda r: erros.append(f"reqfail: {r.url}"))

        await page.goto(f"{BASE}/cozinha-quente", wait_until="networkidle")
        await page.wait_for_timeout(1000)

        # Verificar se o motor carregou SEM instrumentação
        estado = await page.evaluate("""
            () => ({
                motorCarregado: typeof window.playNormalAlert === 'function',
                motorStockout: typeof window.playStockoutAlert === 'function',
                audioOk: !!(window.AudioContext || window.webkitAudioContext)
            })
        """)
        step(1, "motor carregado (sem instrumentacao)", json.dumps(estado))

        # Disparar os 4 sons direto e capturar pageerror em tempo real
        for nome in ["playNormalAlert", "playUrgentAlert", "playStockoutAlert", "playCrossCancelAlert"]:
            res = await page.evaluate(f"""
                () => {{
                    try {{ window.{nome}(); return 'ok'; }}
                    catch (e) {{ return 'ERR: ' + e.message; }}
                }}
            """)
            step(2, f"disparo direto {nome}", res)

        await page.wait_for_timeout(1500)
        erros_sem_instrumento = [e for e in erros if "favicon" not in e and "fonts" not in e]
        step(3, "erros apos disparos diretos", json.dumps(erros_sem_instrumento[:8], ensure_ascii=False))

        # --- Agora com instrumentacao SEM chamar origem: criar demanda real e ver evento chegando ---
        await page.evaluate("""
            () => {
                window.__sons = [];
                window.playNormalAlert = function(){ window.__sons.push('normal'); };
                window.playUrgentAlert = function(){ window.__sons.push('urgent'); };
                window.playStockoutAlert = function(){ window.__sons.push('stockout'); };
                window.playCrossCancelAlert = function(){ window.__sons.push('cross'); };
            }
        """)

        d = criar_demanda(PROD_QUENTE)
        step(4, "demanda quente criada", d["id"])
        await page.wait_for_timeout(1500)
        sons = await page.evaluate("window.__sons")
        step(5, "sons recebidos pela quente", json.dumps(sons, ensure_ascii=False))

        # Stockout na demanda quente
        req = urllib.request.Request(
            f"{BASE}/api/v1/demands/{d['id']}/stockout",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            json.loads(resp.read().decode())
        await page.wait_for_timeout(1500)
        sons2 = await page.evaluate("window.__sons")
        step(6, "sons apos stockout quente", json.dumps(sons2, ensure_ascii=False))

        await page.screenshot(path=os.path.join(SHOTS, "final_execution_01_estado.png"))
        await browser.close()

    step(7, "fim", f"erros={json.dumps(erros_sem_instrumento[:8], ensure_ascii=False)}")


if __name__ == "__main__":
    asyncio.run(main())
