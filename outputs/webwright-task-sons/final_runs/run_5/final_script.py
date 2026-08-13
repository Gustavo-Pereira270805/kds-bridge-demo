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
        browser = await pw.chromium.launch(
            headless=True, channel="chrome",
            args=["--autoplay-policy=user-gesture-required"],
        )
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        salao = await context.new_page()
        await salao.goto(f"{BASE}/salao", wait_until="networkidle")

        quente = await context.new_page()
        await quente.goto(f"{BASE}/cozinha-quente", wait_until="networkidle")
        await quente.wait_for_timeout(800)
        # quente fica em background (salao e a guia ativa)
        await salao.bring_to_front()
        await salao.wait_for_timeout(500)

        quente.logs = []
        quente.on("console", lambda m: quente.logs.append(f"[{m.type}] {m.text}"))
        quente.on("pageerror", lambda e: quente.logs.append(f"[pageerror] {e}"))

        await quente.evaluate("""
            () => {
                window.__sons = [];
                const origem = window.playNormalAlert;
                window.playNormalAlert = function() {
                    window.__sons.push('normal');
                    if (origem) { try { origem.apply(null, arguments); } catch(e) { console.error('motor: ' + e.message); } }
                };
            }
        """)

        # --- 1) Demanda criada com a cozinha em BACKGROUND ---
        d = criar_demanda(PROD_QUENTE)
        step(1, "demanda criada (cozinha em background)", d["id"])
        await salao.wait_for_timeout(4500)  # espera retries 1s/2s/3s
        sons_bg = await quente.evaluate("window.__sons")
        kds_bg = [l for l in quente.logs if "KDS" in l]
        step(2, "sons com guia em background", f"sons={json.dumps(sons_bg, ensure_ascii=False)} console={json.dumps(kds_bg[:5], ensure_ascii=False)}")

        # --- 2) Trazer a guia da cozinha para frente (como 'fixar') ---
        await quente.bring_to_front()
        await quente.wait_for_timeout(1500)
        sons_front = await quente.evaluate("window.__sons")
        kds_front = [l for l in quente.logs if "KDS" in l]
        step(3, "sons ao trazer guia para frente",
             f"sons={json.dumps(sons_front, ensure_ascii=False)} console={json.dumps(kds_front[:5], ensure_ascii=False)}")

        await quente.screenshot(path=os.path.join(SHOTS, "final_execution_01_guia_front.png"))

        # --- 3) Nova demanda agora que a guia está ativa ---
        d2 = criar_demanda(PROD_QUENTE)
        step(4, "nova demanda com guia ativa", d2["id"])
        await quente.wait_for_timeout(2000)
        sons_ativa = await quente.evaluate("window.__sons")
        step(5, "sons com guia ativa", json.dumps(sons_ativa, ensure_ascii=False))

        await browser.close()

    step(6, "fim", "cenario background -> foreground concluido")


if __name__ == "__main__":
    asyncio.run(main())
