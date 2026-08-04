import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright


OUTPUT = Path('outputs/pdf_exports')


async def export_pdf(page, grouping, filename):
    await page.locator('#btnExport').click()
    await page.locator('input[name="exportFormat"][value="pdf"]').check()
    await page.locator('input[name="exportGrouping"][value="' + grouping + '"]').check()
    async with page.expect_download(timeout=120000) as download_info:
        await page.locator('#btnExportConfirm').click()
    download = await download_info.value
    target = OUTPUT / filename
    await download.save_as(target)
    print(filename, target.stat().st_size)
    return target


async def export_excel(page, grouping, filename):
    await page.locator('#btnExport').click()
    await page.locator('input[name="exportFormat"][value="excel"]').check()
    await page.locator('input[name="exportGrouping"][value="' + grouping + '"]').check()
    async with page.expect_download(timeout=120000) as download_info:
        await page.locator('#btnExportConfirm').click()
    download = await download_info.value
    target = OUTPUT / filename
    await download.save_as(target)
    print(filename, target.stat().st_size)
    return target


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.firefox.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 1800}, accept_downloads=True)
        page = await context.new_page()
        errors = []
        logs = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: logs.append(message.text) if message.type == 'info' else None)
        await page.goto('http://localhost:3000/dashboard')
        await page.wait_for_timeout(7000)
        if await page.locator('#btnExport').is_disabled():
            raise RuntimeError('Exportador permanece desabilitado')
        if len(sys.argv) > 1:
            date = sys.argv[1]
            await page.locator('#dateFrom').fill(date)
            await page.locator('#dateTo').fill(date)
            await page.locator('#btnApplyDates').click()
            await page.wait_for_timeout(5000)
        await export_pdf(page, 'consolidado', 'dashboard_current_consolidado.pdf')
        await page.wait_for_timeout(1000)
        await export_pdf(page, 'dia', 'dashboard_current_diario.pdf')
        await page.wait_for_timeout(1000)
        await export_excel(page, 'dia', 'dashboard_current_diario.xlsx')
        print('page_errors', errors)
        print('export_logs', logs)
        await browser.close()


asyncio.run(main())
