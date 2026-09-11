-- Jantar automático (spec docs/superpowers/specs/2026-09-11-jantar-auto-design.md)
-- Horário configurável do disparo + flags diárias (fuso America/Sao_Paulo, resolvido no app).

-- Horário do disparo automático no formato HH:MM (padrão 15:00).
INSERT INTO system_settings (key, value) VALUES ('dinner_auto_time', '15:00')
ON CONFLICT (key) DO NOTHING;

-- Dia (AAAA-MM-DD em America/Sao_Paulo) em que o gerente desligou o auto; '' = ligado.
INSERT INTO system_settings (key, value) VALUES ('dinner_auto_disabled_date', '')
ON CONFLICT (key) DO NOTHING;

-- Dia (AAAA-MM-DD em America/Sao_Paulo) em que o auto já disparou/marcou; '' = ainda não.
INSERT INTO system_settings (key, value) VALUES ('dinner_auto_fired_date', '')
ON CONFLICT (key) DO NOTHING;
