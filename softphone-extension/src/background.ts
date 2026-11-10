// Service worker: orquestra. Cria/garante o offscreen, repassa mensagens
// entre popup e offscreen e guarda o último status de registro.
import type { AnyMessage, StatusSnapshot, SdkConfig } from './shared/messages';

let lastStatus: StatusSnapshot = { status: 'idle' };

async function ensureOffscreen(): Promise<void> {
  // @ts-expect-error hasDocument existe em Chrome recente
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WEB_RTC' as chrome.offscreen.Reason],
    justification: 'Manter o registro SIP e o áudio da chamada via WebRTC.',
  });
}

function sendToOffscreen(msg: Extract<AnyMessage, { target: 'offscreen' }>): void {
  chrome.runtime.sendMessage(msg).catch(() => { /* offscreen pode não estar pronto */ });
}

function broadcastToPopup(msg: Extract<AnyMessage, { target: 'popup' }>): void {
  chrome.runtime.sendMessage(msg).catch(() => { /* popup pode estar fechado */ });
}

chrome.runtime.onMessage.addListener((raw: AnyMessage, _sender, sendResponse) => {
  if (raw.target !== 'background') return;

  (async () => {
    switch (raw.type) {
      case 'INIT_SDK': {
        await ensureOffscreen();
        const config: SdkConfig = raw.config;
        sendToOffscreen({ target: 'offscreen', type: 'INIT', config });
        break;
      }
      case 'CALL': {
        await ensureOffscreen();
        sendToOffscreen({ target: 'offscreen', type: 'CALL', number: raw.number });
        break;
      }
      case 'HANGUP': {
        sendToOffscreen({ target: 'offscreen', type: 'HANGUP' });
        break;
      }
      case 'REQUEST_MIC': {
        // Abre uma janela visível da extensão pra conceder o microfone (o offscreen
        // não consegue exibir o prompt sozinho). A concessão vale pra toda a origem.
        await chrome.windows.create({
          url: chrome.runtime.getURL('request-mic.html'),
          type: 'popup',
          width: 400,
          height: 260,
        });
        break;
      }
      case 'GET_STATUS': {
        sendResponse(lastStatus);
        return;
      }
      case 'STATUS': {
        lastStatus = { status: raw.status, detail: raw.detail };
        broadcastToPopup({ target: 'popup', type: 'STATUS', status: raw.status, detail: raw.detail });
        break;
      }
      case 'CALL_EVENT': {
        broadcastToPopup({ target: 'popup', type: 'CALL_EVENT', event: raw.event, call: raw.call });
        break;
      }
    }
  })();

  // Mantém o canal aberto para respostas assíncronas (GET_STATUS).
  return true;
});
