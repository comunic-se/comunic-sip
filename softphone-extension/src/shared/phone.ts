// Reconhecimento e normalização de telefones brasileiros para o click-to-call.
// Discagem no formato do PBX: DDD + número, sem o 55 (igual à aba Contatos).

/** Candidatos no texto: sequência de dígitos com espaços, parênteses, pontos e hífens. */
export const PHONE_CANDIDATE = /[+(]?\d[\d\s().-]{7,20}\d/g;

/**
 * Converte o texto em número discável (só dígitos, sem 55) ou null se não parecer
 * telefone: exige DDD válido (11–99) + 8 dígitos (fixo) ou 9 dígitos começando com 9 (celular).
 * Recusa datas, CPF/CNPJ com pontuação, horários etc.
 */
export function toDialable(text: string): string | null {
  const raw = String(text ?? '').trim();
  if (!raw || /[/:]/.test(raw)) return null;                 // datas e horários
  if (/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(raw)) return null;    // CPF
  if (/\d{2}\.\d{3}\.\d{3}\/?\d{4}-?\d{2}/.test(raw)) return null; // CNPJ
  let d = raw.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);  // 0 + DDD + fixo (0XX)
  if (d.length !== 10 && d.length !== 11) return null;
  if (!/^[1-9][1-9]/.test(d)) return null;                   // DDD 11–99
  if (d.length === 11 && d[2] !== '9') return null;          // celular começa com 9
  if (d.length === 10 && !/[2-5]/.test(d[2])) return null;   // fixo começa com 2–5
  return d;
}

/** Exibição amigável: (21) 99752-1670 */
export function formatBR(d: string): string {
  return d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}
