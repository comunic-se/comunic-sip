// Click-to-call no Comunic Chat.
// Não altera o DOM do app (React): ao passar o mouse sobre um telefone, mostra um botão
// "Ligar" numa camada própria (Shadow DOM) por cima da página. Clicar disca pela extensão.
// Campos de digitação (input, textarea, editor de mensagem) são ignorados.
import { PHONE_CANDIDATE, toDialable, formatBR } from '../shared/phone';

const HOST_ID = 'comunic-c2c-host';
let host: HTMLElement, root: ShadowRoot, chip: HTMLButtonElement, toast: HTMLDivElement;
let current: string | null = null;
let hideTimer: number | undefined;
let lastMove = 0;

function setup(): void {
  if (document.getElementById(HOST_ID)) return;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host{all:initial}
      .chip{position:fixed;display:none;align-items:center;gap:6px;pointer-events:auto;cursor:pointer;
        font:600 12px/1 Inter,system-ui,-apple-system,sans-serif;color:#fff;background:#2563eb;border:none;
        border-radius:999px;padding:6px 11px 6px 9px;box-shadow:0 4px 12px rgba(15,23,42,.22);white-space:nowrap}
      .chip:hover{background:#1d4ed8}
      .chip svg{width:13px;height:13px}
      .toast{position:fixed;right:20px;bottom:20px;display:none;max-width:320px;pointer-events:none;
        font:500 13px/1.4 Inter,system-ui,-apple-system,sans-serif;color:#fff;background:#0f172a;
        border-radius:10px;padding:10px 14px;box-shadow:0 10px 24px rgba(15,23,42,.25)}
      .toast.err{background:#b91c1c}
    </style>
    <button class="chip" type="button" aria-label="Ligar">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z"/></svg>
      <span></span>
    </button>
    <div class="toast"></div>`;
  chip = root.querySelector('.chip') as HTMLButtonElement;
  toast = root.querySelector('.toast') as HTMLDivElement;
  chip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  chip.addEventListener('mouseleave', scheduleHide);
  chip.addEventListener('mousedown', (e) => e.preventDefault()); // não tira seleção/foco da página
  chip.addEventListener('click', (e) => { e.stopPropagation(); if (current) dial(current); });
  document.documentElement.appendChild(host);
}

function editable(el: Element | null): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const tag = n.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'SCRIPT' || tag === 'STYLE') return true;
    if ((n as HTMLElement).isContentEditable) return true;
  }
  return false;
}

/** Telefone sob o cursor: devolve número discável e a caixa do trecho na tela. */
function phoneAt(x: number, y: number): { number: string; rect: DOMRect } | null {
  const range = document.caretRangeFromPoint?.(x, y);
  const node = range?.startContainer;
  if (!range || !node || node.nodeType !== Node.TEXT_NODE) return null;
  if (editable(node.parentElement)) return null;
  const text = node.textContent ?? '';
  if (text.length > 5000) return null;
  const off = range.startOffset;
  PHONE_CANDIDATE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = PHONE_CANDIDATE.exec(text)); ) {
    const start = m.index, end = start + m[0].length;
    if (off < start || off > end) continue;
    const number = toDialable(m[0]);
    if (!number) return null;
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    const rect = r.getBoundingClientRect();
    // o cursor precisa estar de fato sobre o número (caretRangeFromPoint pega o mais próximo)
    if (x < rect.left - 2 || x > rect.right + 2 || y < rect.top - 2 || y > rect.bottom + 2) return null;
    return { number, rect };
  }
  return null;
}

function show(number: string, rect: DOMRect): void {
  clearTimeout(hideTimer);
  current = number;
  (chip.querySelector('span') as HTMLSpanElement).textContent = `Ligar ${formatBR(number)}`;
  chip.style.display = 'inline-flex';
  const w = chip.offsetWidth, h = chip.offsetHeight;
  let left = rect.right + 6, top = rect.top + rect.height / 2 - h / 2;
  if (left + w > innerWidth - 8) left = Math.max(8, rect.left - w - 6);
  top = Math.min(Math.max(8, top), innerHeight - h - 8);
  chip.style.left = `${left}px`;
  chip.style.top = `${top}px`;
}

function scheduleHide(): void {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => { chip.style.display = 'none'; current = null; }, 350);
}

function notify(msg: string, err = false): void {
  toast.textContent = msg;
  toast.className = err ? 'toast err' : 'toast';
  toast.style.display = 'block';
  window.setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

async function dial(number: string): Promise<void> {
  chip.style.display = 'none';
  try {
    const r = (await chrome.runtime.sendMessage({ target: 'background', type: 'CLICK_TO_CALL', number })) as { ok?: boolean; error?: string } | undefined;
    if (r?.ok) notify(`Ligando para ${formatBR(number)}…`);
    else notify(r?.error ?? 'Não foi possível ligar.', true);
  } catch {
    notify('A extensão Comunic.Chat foi atualizada. Recarregue a página (F5).', true);
  }
}

document.addEventListener('mousemove', (e) => {
  const now = performance.now();
  if (now - lastMove < 60) return; // leve: no máximo ~16 verificações por segundo
  lastMove = now;
  if (e.composedPath().includes(host)) return;
  const hit = phoneAt(e.clientX, e.clientY);
  if (hit) show(hit.number, hit.rect);
  else if (chip.style.display !== 'none') scheduleHide();
}, { passive: true });
document.addEventListener('scroll', () => { if (chip) chip.style.display = 'none'; }, { capture: true, passive: true });

setup();
