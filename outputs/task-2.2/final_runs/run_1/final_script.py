"""Task 2.2 — Verify dashboard layout skeleton.

Checks:
- dashboard.css is linked
- header has .sticky-top + .header-inner
- .layout + aside.side-nav + main.dashboard-main are present
- 5 sections with the verbatim text
- #content is inside #legacyContent (hidden)
- 0 console errors
"""

from pathlib import Path
from playwright.sync_api import sync_playwright

WORKSPACE = Path(__file__).parent
LOG = WORKSPACE / "final_script_log.txt"
SHOTS = WORKSPACE / "screenshots"

def main():
    LOG.write_text("", encoding="utf-8")

    def log(msg):
        line = f"{msg}\n"
        print(line, end="")
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line)

    console_errors = []
    page_errors = []

    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 1800})
        page = context.new_page()

        page.on("console", lambda m: console_errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        log("step 1 action: navigate to /dashboard")
        page.goto("http://localhost:3000/dashboard", wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(3000)  # let JS run

        log("step 2 action: verify dashboard.css link is in head")
        css_linked = page.evaluate("""() => {
            const links = Array.from(document.querySelectorAll('link[rel=stylesheet]'));
            return links.some(l => l.getAttribute('href') && l.getAttribute('href').includes('dashboard.css'));
        }""")
        log(f"  result: dashboard.css linked = {css_linked}")
        page.screenshot(path=str(SHOTS / "step_2_initial.png"), full_page=False)

        log("step 3 action: verify header structure")
        header_info = page.evaluate("""() => {
            const h = document.querySelector('header.sticky-top');
            const inner = document.querySelector('header.sticky-top .header-inner');
            const title = document.querySelector('header.sticky-top .header-title');
            return {
                hasStickyHeader: !!h,
                hasHeaderInner: !!inner,
                titleText: title ? title.textContent : null,
                titleClass: title ? title.className : null,
            };
        }""")
        log(f"  result: {header_info}")

        log("step 4 action: verify layout structure")
        layout_info = page.evaluate("""() => {
            const layout = document.querySelector('.layout');
            const aside = document.querySelector('aside.side-nav#sideNav');
            const main = document.querySelector('main.dashboard-main');
            const topAnchor = document.querySelector('a#top');
            return {
                hasLayout: !!layout,
                hasAside: !!aside,
                asideContent: aside ? aside.innerHTML.trim() : null,
                hasMain: !!main,
                hasTopAnchor: !!topAnchor,
                childCount: main ? main.children.length : 0,
            };
        }""")
        log(f"  result: {layout_info}")

        log("step 5 action: verify 5 sections with verbatim text")
        sections_info = page.evaluate("""() => {
            const expected = [
                {id: 'overview', eyebrow: 'VISÃO GERAL', title: 'Estado do restaurante', desc: 'Volume, fluxo e urgências em tempo real.'},
                {id: 'demand', eyebrow: 'DEMANDA', title: 'Quando e o que sai', desc: 'Heatmap de operação, volume e mix de produtos.'},
                {id: 'sla', eyebrow: 'SLA E TEMPOS', title: 'Eficiência operacional', desc: 'Cumprimento de SLA, velocidade e filas.'},
                {id: 'diagnosis', eyebrow: 'DIAGNÓSTICO', title: 'Problemas e exceções', desc: 'Cancelamentos, roturas e trocas.'},
                {id: 'performance', eyebrow: 'PERFORMANCE', title: 'Notas e detratores', desc: 'Avaliação 0-5 por entidade.'},
            ];
            return expected.map(e => {
                const sec = document.getElementById(e.id);
                if (!sec) return {id: e.id, found: false};
                const eyebrow = sec.querySelector('.section-eyebrow');
                const title = sec.querySelector('.section-title');
                const desc = sec.querySelector('.section-description');
                const bento = sec.querySelector('.bento-grid');
                return {
                    id: e.id,
                    found: true,
                    hasClass: sec.classList.contains('dashboard-section'),
                    ariaLabelledBy: sec.getAttribute('aria-labelledby'),
                    eyebrow: eyebrow ? eyebrow.textContent : null,
                    title: title ? title.textContent : null,
                    desc: desc ? desc.textContent : null,
                    hasBento: !!bento,
                    eyebrowMatch: eyebrow && eyebrow.textContent === e.eyebrow,
                    titleMatch: title && title.textContent === e.title,
                    descMatch: desc && desc.textContent === e.desc,
                };
            });
        }""")
        for s in sections_info:
            log(f"  section {s['id']}: found={s.get('found')} eyebrow={s.get('eyebrowMatch')} title={s.get('titleMatch')} desc={s.get('descMatch')}")

        log("step 6 action: verify legacyContent wraps #content")
        legacy_info = page.evaluate("""() => {
            const legacy = document.getElementById('legacyContent');
            const content = document.getElementById('content');
            return {
                legacyExists: !!legacy,
                legacyHidden: legacy ? legacy.hasAttribute('hidden') : false,
                contentExists: !!content,
                contentInsideLegacy: legacy ? legacy.contains(content) : false,
                contentStyle: content ? content.getAttribute('style') : null,
            };
        }""")
        log(f"  result: {legacy_info}")

        log("step 7 action: verify KPI strip placeholder")
        kpi_info = page.evaluate("""() => {
            const strip = document.getElementById('kpiStrip');
            return {
                exists: !!strip,
                hasClass: strip ? strip.classList.contains('kpi-strip') : false,
                content: strip ? strip.innerHTML.trim() : null,
            };
        }""")
        log(f"  result: {kpi_info}")

        log("step 8 action: take final screenshot")
        page.screenshot(path=str(SHOTS / "step_8_final.png"), full_page=False)

        log(f"step 9 action: console errors count = {len(console_errors)}")
        for err in console_errors:
            log(f"  ERR: {err}")
        log(f"step 10 action: page errors count = {len(page_errors)}")
        for err in page_errors:
            log(f"  PAGE_ERR: {err}")

        # Summary
        all_ok = (
            css_linked
            and header_info['hasStickyHeader']
            and header_info['hasHeaderInner']
            and header_info['titleText'] == 'Dashboard'
            and layout_info['hasLayout']
            and layout_info['hasAside']
            and layout_info['hasMain']
            and all(s.get('found') and s.get('eyebrowMatch') and s.get('titleMatch') and s.get('descMatch') for s in sections_info)
            and legacy_info['legacyExists']
            and legacy_info['legacyHidden']
            and legacy_info['contentInsideLegacy']
            and len(console_errors) == 0
            and len(page_errors) == 0
        )
        log(f"FINAL: all_ok = {all_ok}")

        browser.close()
    return 0 if all_ok else 1

if __name__ == "__main__":
    import sys
    sys.exit(main())
