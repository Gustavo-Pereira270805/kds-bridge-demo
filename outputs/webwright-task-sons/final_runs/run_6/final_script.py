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


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}", data=data,
        headers={"Content-Type": "application/json"}, method=method,
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

        paginas = {}
        for nome, url in [("quente", f"{BASE}/cozinha-quente"), ("fria", f"{BASE}/cozinha-fria")]:
            p = await context.new_page()
            p.logs = []
            p.on("console", lambda m, n=nome: p.logs.append(f"[{m.type}] {m.text}"))
            p.on("pageerror", lambda e, n=nome: p.logs.append(f"[pageerror] {e}"))
            await p.goto(url, wait_until="networkidle")
            await p.wait_for_timeout(800)
            paginas[nome] = p
            await p.evaluate("""
                () => {
                    window.__sons = [];
                    const origem = window.playCrossCancelAlert;
                    window.playCrossCancelAlert = function() {
                        window.__sons.push('cross');
                        if (origem) { try { origem.apply(null, arguments); } catch(e) {} }
                    };
                }
            """)
        step(1, "cozinhas abertas e instrumentadas")

        # Criar demanda na estação QUENTE, aguardar o queue engine travar (cooking_started)
        d = api("POST", "/api/v1/demands", {"product_id": PROD_QUENTE, "quantity": 1})
        step(2, "demanda quente criada", d["id"])
        for i in range(5):
            await paginas["quente"].wait_for_timeout(1000)
            info = api("GET", f"/api/v1/demands")
            current = next((x for x in info if x["id"] == d["id"]), None)
            if current and current.get("cooking_started"):
                step(3, "demanda travada (cooking_started=true)")
                break
        else:
            step(3, "demanda NAO travou", "segue mesmo assim")

        # Cancelar pelo salão
        api("PATCH", f"/api/v1/demands/{d['id']}/cancel-salao", {"reason": "teste cross-cancel"})
        step(4, "cancel-salao executado")
        await paginas["quente"].wait_for_timeout(1500)
        await paginas["fria"].wait_for_timeout(1500)

        sons_q = await paginas["quente"].evaluate("window.__sons")
        sons_f = await paginas["fria"].evaluate("window.__sons")
        step(5, "cross-cancel sons",
             f"quente={json.dumps(sons_q, ensure_ascii=False)} fria={json.dumps(sons_f, ensure_ascii=False)}")

        # Criar demanda na FRIA, travar, cancelar
        d2 = api("POST", "/api/v1/demands", {"product_id": PROD_FRIA, "quantity": 1})
        step(6, "demanda fria criada", d2["id"])
        for i in range(5):
            await paginas["fria"].wait_for_timeout(1000)
            info = api("GET", "/api/v1/demands")
            current = next((x for x in info if x["id"] == d2["id"]), None)
            if current and current.get("cooking_started"):
                step(7, "demanda fria travada")
                break

        api("PATCH", f"/api/v1/demands/{d2['id']}/cancel-salao", {"reason": "teste cross-cancel fria"})
        step(8, "cancel-salao fria executado")
        await paginas["quente"].wait_for_timeout(1500)
        await paginas["fria"].wait_for_timeout(1500)

        sons_q2 = await paginas["quente"].evaluate("window.__sons")
        sons_f2 = await paginas["fria"].evaluate("window.__sons")
        step(9, "cross-cancel fria sons",
             f"quente={json.dumps(sons_q2, ensure_ascii=False)} fria={json.dumps(sons_f2, ensure_ascii=False)}")

        await browser.close()

    step(10, "fim", "roteamento de cross-cancel verificado")


if __name__ == "__main__":
    asyncio.run(main())
