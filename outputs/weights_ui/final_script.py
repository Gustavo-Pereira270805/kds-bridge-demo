import asyncio
import os
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3000"
OUT = os.path.dirname(__file__)
SHOTS = os.path.join(OUT, "screenshots")
os.makedirs(SHOTS, exist_ok=True)

step = 0
def nxt():
    global step
    step += 1
    return step

async def main():
    log = []
    async def snap(name, page):
        n = nxt()
        p = os.path.join(SHOTS, f"final_execution_{n:02d}_{name}.png")
        await page.screenshot(path=p)
        log.append(f"step {n} action: {name}")
        return n

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 900})

        # CP1: load admin page
        await page.goto(BASE + "/admin", wait_until="networkidle", timeout=15000)
        await page.wait_for_timeout(500)
        await snap("admin_loaded", page)
        print("CP1 PASS: página /admin carregada")

        # CP2: click tab and verify 5 inputs present + filled
        # Clica na aba de pesos
        await page.click(".tab:has-text('Critérios de Avaliação')")
        await page.wait_for_timeout(1000)
        
        panel = await page.query_selector("#panel-weights")
        assert panel is not None, "Painel #panel-weights não encontrado!"
        visible = await panel.is_visible()
        assert visible, f"Painel não está visível! (visible={visible})"
        print("CP2 PASS: Painel visível com sucesso!")

        # Aguardar requisição GET carregar dados
        await page.wait_for_timeout(1000)
        for inp_id in ["weightSlaBreach", "weightCancellation", "weightStockoutSalao", "weightSlowItem"]:
            val = await page.input_value(f"#{inp_id}")
            assert val != "" and val is not None, f"Campo {inp_id} vazio"
            print(f"  Input #{inp_id} = {val}")
        await snap("weights_panel_loaded", page)

        # CP3: change one weight, save, see toast
        print("CP3: alterando #weightSlowItem para 0.25 e salvando...")
        await page.fill("#weightSlowItem", "0.25")
        await page.click("button:has-text('Salvar e Recalcular')")
        
        # Pode demorar um pouco porque o backend agora recalcula todas as datas no BD
        print("  Aguardando resposta do recálculo...")
        
        toast_ok = await page.wait_for_selector(".toast", timeout=10000)
        assert toast_ok is not None, "Nenhum toast apareceu"
        toast_text = await toast_ok.text_content()
        print(f"  Toast exibido: '{toast_text}'")
        assert "Pesos salvos" in toast_text, f"Toast com erro: {toast_text}"
        await snap("saved_toast", page)
        print("CP3 PASS: valor alterado e salvo com confirmação de toast")

        # CP4: reload and verify persisted
        print("CP4: recarregando a página para testar persistência...")
        await page.reload(wait_until="networkidle", timeout=15000)
        await page.click(".tab:has-text('Critérios de Avaliação')")
        await page.wait_for_timeout(1000)
        
        val_after = await page.input_value("#weightSlowItem")
        assert val_after == "0.25", f"Era esperado 0.25 mas veio {val_after}"
        await snap("persisted_after_reload", page)
        print(f"CP4 PASS: valor persistido após reload: {val_after}")

        # Restore original value (0.10)
        await page.fill("#weightSlowItem", "0.10")
        await page.click("button:has-text('Salvar e Recalcular')")
        await page.wait_for_timeout(800)
        print("RESTORED: weightSlowItem restaurado para 0.10")

        await browser.close()

    with open(os.path.join(OUT, "final_script_log.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(log) + "\n")

asyncio.run(main())