CREATE TABLE IF NOT EXISTS pi_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text NOT NULL CHECK (target IN ('quente','fria','ambos')),
  action text NOT NULL CHECK (action IN ('shutdown','reboot')),
  by text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  online boolean NOT NULL DEFAULT false
);
