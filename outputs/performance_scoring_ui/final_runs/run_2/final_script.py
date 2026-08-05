import asyncio
from pathlib import Path

from playwright.async_api import async_playwright


RUN_DIR = Path(__file__).resolve().parent
SCREENSHOTS = RUN_DIR / "screenshots"
LOG_PATH = RUN_DIR / "final_script_log.txt"


async def main():
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    lines = []

    def log(message):
        lines.append(message)
        LOG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    async with async_playwright() as pw:
        browser = await pw.firefox.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 1800})
        log("step 1 action: carregar dashboard e aguardar dados")
        await page.goto("http://127.0.0.1:3000/dashboard", wait_until="networkidle", timeout=60000)
        await page.wait_for_selector("#performance .score-card", timeout=60000)
        await page.locator("#btnExport").wait_for(state="visible")
        assert await page.locator("#btnExport").is_enabled()

        log("step 2 action: abrir exportacao e confirmar Excel consolidado")
        await page.locator("#btnExport").click()
        await page.locator("#exportModal").wait_for(state="visible")
        await page.locator('input[name="exportFormat"][value="excel"]').check()
        await page.screenshot(path=str(SCREENSHOTS / "01-export-modal-excel.png"))
        async with page.expect_download(timeout=60000) as download_info:
            await page.locator("#btnExportConfirm").click()
        download = await download_info.value
        assert download.suggested_filename.endswith(".xlsx")
        await download.save_as(str(RUN_DIR / "performance-export.xlsx"))
        log("download Excel: " + download.suggested_filename)

        log("step 3 action: abrir exportacao e confirmar PDF consolidado")
        await page.locator("#btnExport").click()
        await page.locator("#exportModal").wait_for(state="visible")
        await page.locator('input[name="exportFormat"][value="pdf"]').check()
        await page.screenshot(path=str(SCREENSHOTS / "02-export-modal-pdf.png"))
        async with page.expect_download(timeout=60000) as pdf_info:
            await page.locator("#btnExportConfirm").click()
        pdf = await pdf_info.value
        assert pdf.suggested_filename.endswith(".pdf")
        await pdf.save_as(str(RUN_DIR / "performance-export.pdf"))
        log("download PDF: " + pdf.suggested_filename)

        source = Path("src/views/dashboard.html").read_text(encoding="utf-8")
        export_start = source.index("function appendPerformanceExcel")
        export_end = source.index("async function exportPDF", export_start)
        export_source = source[export_start:export_end]
        assert "Itens lentos" not in export_source
        assert "Math.min(2.5" not in export_source
        log("resultado final: exportacoes baixadas sem coluna ou deducao sintetica")
        await browser.close()


asyncio.run(main())
