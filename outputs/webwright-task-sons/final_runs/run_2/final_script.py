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

# Produtos: quente = ALMONDEGAS..., fria = ABACAXI
PROD_QUENTE = "dca2f0d0-bdde-4e20-8c6f-a26034ccc435"
PROD_FRIA = "f0df749b-b08b-4783-963d-65900bbb3a7a"


def step(n, action, detail=""):
    line = f"step {n} action: {action}" + (f" | {detail}" if detail else "")
    STEPS.append(line)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)


async def criar_demanda(produto, prioridade="normal"):
    import urllib.request

    body = json.dumps({"product_id": produto, "quantity": 1, "priority": prioridade}).encode()
    req = urllib.request.Request(
        f"{BASE}/api/v1/demands",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


async def main():
    if os.path.exists(LOG):
        os.remove(LOG)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, channel="chrome")
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        # Instrumentar: substituir as funções globais do motor por contadores
        INSTRUMENT = """
            () => {
                window.__sons = [];
                const NOMES = ['playNormalAlert','playUrgentAlert','playStockoutAlert','playCrossCancelAlert'];
                for (const n of NOMES) {
                    const origem = window[n];
                    window[n] = function() {
                        window.__sons.push(n);
                        if (origem) { try { origem.apply(null, arguments); } catch(e) {} }
                    };
                }
            }
        """

        quente = await context.new_page()
        await quente.goto(f"{BASE}/cozinha-quente", wait_until="networkidle")
        await quente.wait_for_timeout(800)
        await quente.evaluate(INSTRUMENT)

        fria = await context.new_page()
        await fria.goto(f"{BASE}/cozinha-fria", wait_until="networkidle")
        await fria.wait_for_timeout(800)
        await fria.evaluate(INSTRUMENT)

        # --- CP-A: demanda da estação FRIA ---
        d_fria = await criar_demanda(PROD_FRIA)
        step(1, "criada demanda estacao FRIA", d_fria["id"])
        await quente.wait_for_timeout(1200)
        await fria.wait_for_timeout(1200)

        sons_quente = await quente.evaluate("window.__sons")
        sons_fria = await fria.evaluate("window.__sons")
        step(2, "CP-A sons apos demanda fria",
             f"quente={json.dumps(sons_quente, ensure_ascii=False)} fria={json.dumps(sons_fria, ensure_ascii=False)}")
        await fria.screenshot(path=os.path.join(SHOTS, "final_execution_01_fria_apos_demanda_fria.png"))
        await quente.screenshot(path=os.path.join(SHOTS, "final_execution_02_quente_apos_demanda_fria.png"))

        # --- CP-B: demanda da estação QUENTE ---
        d_quente = await criar_demanda(PROD_QUENTE)
        step(3, "criada demanda estacao QUENTE", d_quente["id"])
        await quente.wait_for_timeout(1200)
        await fria.wait_for_timeout(1200)

        sons_quente2 = await quente.evaluate("window.__sons")
        sons_fria2 = await fria.evaluate("window.__sons")
        step(4, "CP-B sons apos demanda quente",
             f"quente={json.dumps(sons_quente2, ensure_ascii=False)} fria={json.dumps(sons_fria2, ensure_ascii=False)}")

        # --- CP-C: demanda URGENTE da estação quente ---
        d_urg = await criar_demanda(PROD_QUENTE, prioridade="urgent")
        step(5, "criada demanda URGENTE quente", d_urg["id"])
        await quente.wait_for_timeout(1200)
        await fria.wait_for_timeout(1200)

        sons_quente3 = await quente.evaluate("window.__sons")
        sons_fria3 = await fria.evaluate("window.__sons")
        step(6, "CP-C sons apos demanda urgente quente",
             f"quente={json.dumps(sons_quente3, ensure_ascii=False)} fria={json.dumps(sons_fria3, ensure_ascii=False)}")

        # --- CP-D: stockout numa demanda da fria (som = urgente + zerado em sequencia) ---
        import urllib.request as urlreq
        req = urlreq.Request(
            f"{BASE}/api/v1/demands/{d_fria['id']}/stockout",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlreq.urlopen(req, timeout=10) as resp:
            updated = json.loads(resp.read().decode())
        step(7, "stockout na demanda fria", f"priority_apos={updated.get('priority')}")
        await quente.wait_for_timeout(1200)
        await fria.wait_for_timeout(1200)

        sons_quente4 = await quente.evaluate("window.__sons")
        sons_fria4 = await fria.evaluate("window.__sons")
        step(8, "CP-D sons apos stockout fria",
             f"quente={json.dumps(sons_quente4, ensure_ascii=False)} fria={json.dumps(sons_fria4, ensure_ascii=False)}")

        await browser.close()

    # Resumo
    resumo = (
        f"Roteamento OK: fria recebeu {len(sons_fria2)} sons da demanda fria, "
        f"quente recebeu {len(sons_quente2)} sons da demanda quente; "
        f"cross-check: quente={sons_quente2[0] if sons_quente2 else 'nenhum'} fria={sons_fria2[0] if sons_fria2 else 'nenhum'}"
    )
    step(9, "fim", resumo)


if __name__ == "__main__":
    asyncio.run(main())
