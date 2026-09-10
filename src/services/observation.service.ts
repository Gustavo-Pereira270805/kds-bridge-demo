// Observações do salão guardadas somente em runtime (sem DB).
// O Map vive no processo do servidor: restart apaga tudo — comportamento
// esperado (ver docs/superpowers/specs/2026-09-10-observacoes-salao-design.md).
const observations = new Map<string, string>();

export function setObservation(id: string, text: string): void {
  if (!id || !text) return;
  observations.set(id, text);
}

export function getObservation(id: string): string | undefined {
  if (!id) return undefined;
  return observations.get(id);
}

export function clearObservation(id: string): void {
  if (!id) return;
  observations.delete(id);
}
