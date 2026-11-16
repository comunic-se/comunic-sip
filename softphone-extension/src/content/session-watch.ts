// Monitor da sessão do Comunic Chat (content script nas páginas do app).
//
// O token de acesso da Helena vale ~1 h e a própria página o renova com o
// refresh-token, guardando o atual em sessionStorage["context"]. Ler daqui dá
// ao background SEMPRE o token vigente, sem depender de a página fazer alguma
// requisição. O background usa esse token para (re)conectar o ramal e renovar
// a assinatura do SDK — assim o ramal fica ativo enquanto o Comunic Chat estiver
// logado, por quanto tempo for.

type HelenaSession = { token: string; expiresAt?: number } | null;

const CHECK_MS = 60_000;        // confere a sessão a cada minuto
const HEARTBEAT_MS = 5 * 60_000; // reenvia mesmo sem mudança (acorda o watchdog)

function readSession(): HelenaSession {
  try {
    const raw = sessionStorage.getItem('context');
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    const token = typeof ctx?.accessToken === 'string' ? ctx.accessToken : '';
    if (!token || ctx?.authenticated === false) return null;
    return { token, expiresAt: jwtExp(token) };
  } catch {
    return null;
  }
}

/** exp do JWT (epoch em segundos), sem validar assinatura — só para saber a validade. */
function jwtExp(token: string): number | undefined {
  try {
    const part = token.split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : undefined;
  } catch {
    return undefined;
  }
}

let lastSent = '';
let lastSentAt = 0;

function report(force = false): void {
  const s = readSession();
  if (!s) return;
  const now = Date.now();
  if (!force && s.token === lastSent && now - lastSentAt < HEARTBEAT_MS) return;
  lastSent = s.token;
  lastSentAt = now;
  chrome.runtime
    .sendMessage({ target: 'background', type: 'HELENA_SESSION', token: s.token, expiresAt: s.expiresAt })
    .catch(() => { /* extensão recarregada: este script fica órfão até a página recarregar */ });
}

// O background pede o token atual quando o guardado venceu.
chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.target !== 'content' || msg?.type !== 'GET_HELENA_SESSION') return undefined;
  sendResponse(readSession());
  return undefined;
});

report(true);
setInterval(() => report(), CHECK_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) report(); });
window.addEventListener('focus', () => report());
