// Quiosques (Pis) identificados pelo IP — sem conta, sem token.
// Atrás do Caddy, o IP real é a ÚLTIMA entrada do X-Forwarded-For
// (o Caddy anexa o que ele viu; anteriores vêm do cliente).
// Premissa: porta 3000 não publicada — tudo chega via Caddy.

function ipsPermitidos(): string[] {
  return (process.env.KDS_KIOSK_IPS ?? '')
    .split(',')
    .map((s) => normalizeIp(s))
    .filter((s) => s.length > 0);
}

export function normalizeIp(ip: string): string {
  return String(ip ?? '').trim().replace(/^\[|\]$/g, '').toLowerCase();
}

export function clientIpFromHeaders(xff: unknown, fallback: string): string {
  const raw = Array.isArray(xff) ? xff.join(',') : String(xff ?? '');
  const partes = raw.split(',').map((s) => normalizeIp(s)).filter((s) => s.length > 0);
  if (partes.length > 0) return partes[partes.length - 1];
  return normalizeIp(fallback);
}

export function isKioskIp(ip: string): boolean {
  const normalizado = normalizeIp(ip);
  if (!normalizado) return false;
  return ipsPermitidos().includes(normalizado);
}

export function socketIp(sock: {
  handshake: { headers: Record<string, string | string[] | undefined>; address: string };
}): string {
  return clientIpFromHeaders(sock.handshake.headers['x-forwarded-for'], sock.handshake.address);
}
