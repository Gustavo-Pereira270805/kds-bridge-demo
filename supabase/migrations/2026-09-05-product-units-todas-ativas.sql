-- Lote 2: todo produto aceita todas as unidades ativas.
-- As favoritas (units.featured, estrela ★ no admin) continuam primeiro
-- no dropdown do salão via ORDER BY featured DESC em /units/by-product.
INSERT INTO product_units (product_id, unit_id)
SELECT p.id, u.id
  FROM products p
 CROSS JOIN units u
 WHERE u.active = true
ON CONFLICT (product_id, unit_id) DO NOTHING;
