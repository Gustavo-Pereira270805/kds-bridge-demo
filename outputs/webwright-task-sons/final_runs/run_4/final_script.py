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
        # Autoplay estrito: simula o Chrome real do usuário (sem gesto = sem áudio)
        browser = await pw.chromium.launch(
            headless=True,
            channel="chrome",
            args=["--autoplay-policy=user-gesture-required"],
        )
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        paginas = {}
        for nome, url in [
            ("salao", f"{BASE}/salao"),
            ("quente", f"{BASE}/cozinha-quente"),
            ("fria", f"{BASE}/cozinha-fria"),
        ]:
            p = await context.new_page()
            p.logs = []
            p.on("console", lambda m, n=nome: p.logs.append(f"[{m.type}] {m.text}"))
            p.on("pageerror", lambda e, n=nome: p.logs.append(f"[pageerror] {e}"))
            await p.goto(url, wait_until="networkidle")
            await p.wait_for_timeout(800)
            paginas[nome] = p
        step(1, "3 guias abertas (salao, quente, fria)")

        # Instrumentar as cozinhas (sem engolir o som real: só contador ao lado do motor)
        for nome in ["quente", "fria"]:
            await paginas[nome].evaluate("""
                () => {
                    window.__sons = [];
                    const NOMES = ['playNormalAlert','playUrgentAlert','playStockoutAlert','playCrossCancelAlert'];
                    for (const n of NOMES) {
                        const origem = window[n];
                        window[n] = function() {
                            window.__sons.push(n);
                            if (origem) { try { origem.apply(null, arguments); } catch(e) { console.error('motor: ' + e.message); } }
                        };
                    }
                }
            """)

        # Demanda COMUM na estação quente (criada via HTTP, como o salão faz)
        d1 = criar_demanda(PROD_QUENTE)
        step(2, "demanda comum quente criada", d1["id"])
        await asyncio.gather(*[p.wait_for_timeout(1500) for p in paginas.values()])

        # Demanda URGENTE na estação fria
        d2 = criar_demanda(PROD_FRIA, prioridade="urgent")
        step(3, "demanda urgente fria criada", d2["id"])
        await asyncio.gather(*[p.wait_for_timeout(1500) for p in paginas.values()])

        # Stockout na demanda quente
        req = urllib.request.Request(
            f"{BASE}/api/v1/demands/{d1['id']}/stockout",
            data=b"{}", headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            json.loads(resp.read().decode())
        step(4, "stockout na demanda quente")
        await asyncio.gather(*[p.wait_for_timeout(2000) for p in paginas.values()])

        # Relatório
        for nome, p in paginas.items():
            sons = await p.evaluate("window.__sons") if nome != "salao" else []
            logs = [l for l in p.logs if "favicon" not in l and "fonts" not in l and "KDS" in l or "KDS" in l]
            step(5, f"relatorio {nome}",
                 f"sons={json.dumps(sons, ensure_ascii=False)} console_kds={json.dumps(logs[:6], ensure_ascii=False)}")
            await p.screenshot(path=os.path.join(SHOTS, f"final_execution_{nome}.png"))

        # GESTO real na cozinha quente (clique trusted) e nova demanda
        await paginas["quente"].mouse.click(640, 400)
        step(6, "gesto (clique) na tela da cozinha quente")
        d3 = criar_demanda(PROD_QUENTE)
        await asyncio.gather(*[p.wait_for_timeout(1500) for p in paginas.values()])
        sons_q = await paginas["quente"].evaluate("window.__sons")
        logs_q = [l for l in paginas["quente"].logs if "KDS" in l]
        step(7, "apos gesto + nova demanda quente", f"sons={json.dumps(sons_q, ensure_ascii=False)} console_kds={json.dumps(logs_q[:6], ensure_ascii=False)}")

        await browser.close()

    step(8, "fim", "simulacao com autoplay estrito concluida")


if __name__ == "__main__":
    asyncio.run(main())
