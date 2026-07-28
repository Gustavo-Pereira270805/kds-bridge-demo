# Critical Points

- [x] CP1: /dashboard loads with side nav visible at 64px wide (collapsed) at the left — confirmed nav_w=64px at load (log step 1)
- [x] CP2: Clicking Visão Geral link scrolls to `#overview`, sets `aria-current="true"` on that link, teal pill (left border) + primary text — confirmed nav_w=64px (collapsed, not hovered) + active=[overview] in log step 2; teal border visible on Visão Geral icon in `final_execution_1_section_overview.png`
- [x] CP3: Clicking Demanda link scrolls to `#demand`, sets `aria-current="true"` on that link — confirmed active=[demand] in log step 3; teal border on Demanda icon in `final_execution_2_section_demand.png`
- [x] CP4: Clicking Performance link scrolls to `#performance`, sets `aria-current="true"` on that link — confirmed active=[performance] in log step 4; teal border on Performance icon in `final_execution_3_section_performance.png`
- [x] CP5: Hovering over the side nav expands it to 240px wide with labels visible — confirmed expanded width=240px, first label opacity=1 in log step 5; all 6 labels visible in `final_execution_4_hover_expanded.png`
- [x] CP6: Other nav items (not active) show muted text and no teal border — visible in all 3 section screenshots (only the active item has teal border)
- [x] CP7: Section header (eyebrow + title + description) visible in each section — VISÃO GERAL / Estado do restaurante, DEMANDA / Quando e o que sai, PERFORMANCE / Notas e detratures all visible
- [x] CP8: 0 console errors during all interactions — console_errors=[] (log step 6 + FINAL_RESPONSE)
