import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright


RUN_DIR = Path(__file__).resolve().parent
SCREENSHOTS = RUN_DIR / "screenshots"
LOG_PATH = RUN_DIR / "final_script_log.txt"


def write_log(lines):
    LOG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


async def main():
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    lines = []
    page_errors = []

    def step(number, message):
        lines.append("step %s action: %s" % (number, message))
        write_log(lines)

    async with async_playwright() as pw:
        browser = await pw.firefox.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 1800})
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        step(1, "consultar API de pesos e performance")
        weights_response = await page.request.get("http://127.0.0.1:3000/api/v1/admin/settings/weights")
        assert weights_response.ok
        weights = await weights_response.json()
        assert set(weights) == {
            "sla_min",
            "sla_max",
            "cancellation_cozinha",
            "cancellation_salao",
            "stockout_salao",
        }
        performance_response = await page.request.get(
            "http://127.0.0.1:3000/api/v1/analytics/performance?range=week"
        )
        assert performance_response.ok
        performance = await performance_response.json()
        assert set(performance["weights"]) == set(weights)
        all_entities = list(performance["current"].values()) + list(performance["averages"].values())
        assert all("slow_items" not in item and "slow_item_deduction" not in item for item in all_entities)
        occurrences = [occ for values in performance["detractor_dates"].values() for occ in values]
        assert all("deduction" in occ and "station" in occ for occ in occurrences)
        lines.append("API weights: " + json.dumps(weights, ensure_ascii=False))
        lines.append("API ocorrencias verificadas: %s" % len(occurrences))
        write_log(lines)

        step(2, "abrir dashboard e verificar cards de performance")
        await page.goto("http://127.0.0.1:3000/dashboard", wait_until="networkidle", timeout=60000)
        await page.wait_for_selector("#performance .score-card", timeout=60000)
        performance_section = page.locator("#performance")
        await performance_section.scroll_into_view_if_needed()
        await page.screenshot(path=str(SCREENSHOTS / "01-performance-cards.png"))
        assert await page.locator("#performance .score-card").count() > 0

        step(3, "abrir detalhamento e validar deducao, estacao e fechamento")
        panels = page.locator("#performance .score-detail-panel")
        assert await panels.count() > 0
        table_entity = None
        empty_entity = None
        for index in range(await panels.count()):
            panel = panels.nth(index)
            entity = await panel.get_attribute("data-entity")
            if await panel.locator("table").count() and table_entity is None:
                table_entity = entity
            if await panel.get_by_text("Sem ocorrências registradas.").count() and empty_entity is None:
                empty_entity = entity
        chosen_entity = table_entity or empty_entity
        assert chosen_entity
        await page.locator('.score-card[data-entity="%s"]' % chosen_entity).click()
        visible_panel = page.locator('.score-detail-panel[data-entity="%s"]' % chosen_entity)
        await visible_panel.wait_for(state="visible")
        if table_entity:
            headers = await visible_panel.locator("th").all_text_contents()
            assert "Dedução" in headers
            assert "Estação" in headers
        else:
            assert await visible_panel.get_by_text("Sem ocorrências registradas.").count() > 0
        await page.screenshot(path=str(SCREENSHOTS / "02-performance-detail.png"))
        await visible_panel.locator(".score-detail-close").click()
        assert await page.locator("#performance .score-card.selected").count() == 0
        assert await page.locator("#performance .score-detail-panel:visible").count() == 0
        await page.screenshot(path=str(SCREENSHOTS / "03-performance-detail-closed.png"))

        step(4, "abrir modal e conferir pesos reais e escala")
        await page.locator("#btnCriteria").click()
        modal = page.locator("#criteriaModal")
        await modal.wait_for(state="visible")
        modal_text = await modal.inner_text()
        lines.append("modal text: " + modal_text.replace("\n", " | "))
        write_log(lines)
        await page.screenshot(path=str(SCREENSHOTS / "04-criteria-modal.png"))
        assert "0,05" in modal_text or "0.05" in modal_text
        assert "0,30" in modal_text or "0.30" in modal_text
        assert ">=4,5" in modal_text or "≥4,5" in modal_text
        assert "Item lento" not in modal_text
        assert "Zerado (cozinha)" in modal_text
        await page.locator("#btnCriteriaClose").click()

        step(5, "abrir admin e validar cinco inputs e PUT invalido")
        await page.goto("http://127.0.0.1:3000/admin", wait_until="networkidle", timeout=60000)
        await page.get_by_text("Critérios", exact=False).first.click()
        panel = page.locator("#panel-weights")
        await panel.wait_for(state="visible")
        input_ids = [
            "weightCancellationCozinha",
            "weightCancellationSalao",
            "weightStockoutSalao",
            "weightSlaMin",
            "weightSlaMax",
        ]
        for input_id in input_ids:
            value = await page.locator("#" + input_id).input_value()
            assert value != ""
        invalid = await page.request.put(
            "http://127.0.0.1:3000/api/v1/admin/settings/weights",
            data={
                "cancellation_cozinha": 0.30,
                "cancellation_salao": 0.30,
                "stockout_salao": 0.10,
                "sla_min": 0.40,
                "sla_max": 0.20,
            },
        )
        assert invalid.status == 400
        await page.screenshot(path=str(SCREENSHOTS / "05-admin-weights.png"))

        assert not page_errors, page_errors
        lines.append("resultado final: verificacao webwright concluida sem alterar pesos")
        write_log(lines)
        await browser.close()


asyncio.run(main())
