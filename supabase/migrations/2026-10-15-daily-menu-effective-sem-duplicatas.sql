-- Cardápio efetivo sem duplicatas.
--
-- Problema: o turno jantar adiciona TODOS os produtos ativos da Cozinha Jantar
-- ao cardápio do dia via daily_menu_overrides ('add') — inclusive os que já
-- fazem parte da base do cardápio (menu_products), como DELÍCIA DE FRANGO,
-- INHAME COZIDO, DELÍCIA DE PEIXE e MACAXEIRA COZIDA. Como a view é
-- base UNION ALL adições, esses itens apareciam DUAS vezes no cardápio do dia
-- (salão, /gerente e /admin).
--
-- Correção: a adição manual não repete um produto que já está na base do
-- cardápio do dia. A semântica de remoção (override 'remove') não muda.
CREATE OR REPLACE VIEW daily_menu_effective AS
SELECT dm.date,
  dm.id AS daily_menu_id,
  mp.product_id,
  p.name,
  p.category,
  'base'::text AS origin,
  NULL::text AS default_unit
FROM daily_menus dm
  JOIN menu_products mp ON mp.menu_id = dm.menu_id
  JOIN products p ON p.id = mp.product_id AND p.active = true
WHERE NOT EXISTS (
  SELECT 1 FROM daily_menu_overrides dmo
  WHERE dmo.daily_menu_id = dm.id
    AND dmo.product_id = mp.product_id
    AND dmo.action::text = 'remove'::text
)
UNION ALL
SELECT dm.date,
  dm.id AS daily_menu_id,
  dmo.product_id,
  p.name,
  p.category,
  'manual_add'::text AS origin,
  NULL::text AS default_unit
FROM daily_menus dm
  JOIN daily_menu_overrides dmo ON dmo.daily_menu_id = dm.id AND dmo.action::text = 'add'::text
  JOIN products p ON p.id = dmo.product_id AND p.active = true
WHERE NOT EXISTS (
  SELECT 1 FROM menu_products mp
  WHERE mp.menu_id = dm.menu_id
    AND mp.product_id = dmo.product_id
);
