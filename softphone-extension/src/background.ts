// Service worker: orquestra. Cria/garante o offscreen, repassa mensagens
// entre popup e offscreen e guarda o último status de registro e da chamada.
import type { AnyMessage, CallState, StatusSnapshot, SdkConfig } from './shared/messages';

const NOTIF_ID = 'comunic-call';
const MISSED_ID = 'comunic-missed';
let lastStatus: StatusSnapshot = { status: 'idle' };
let lastCallState: CallState = { active: false };
// Qual ação cada botão da notificação dispara (depende do estado da chamada).
let notifButtons: ('answer' | 'reject' | 'hangup')[] = [];
// Rastreio da chamada atual para detectar "perdida".
let curInbound = false;
let curTalked = false;
let curPeer = '';

function trackCall(state: CallState): void {
  if (state.active) {
    if (state.direction === 'inbound') curInbound = true;
    if (state.callStatus === 'talking') curTalked = true;
    curPeer = state.name || state.number || 'Desconhecido';
  } else {
    // Chamada encerrou: se era recebida e nunca foi atendida → perdida.
    if (curInbound && !curTalked) {
      chrome.notifications.create(MISSED_ID, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon-128.png'),
        title: 'Chamada perdida',
        message: curPeer,
        priority: 1,
      });
    }
    curInbound = false;
    curTalked = false;
    curPeer = '';
  }
}

function updateCallNotification(state: CallState): void {
  if (!state.active) {
    notifButtons = [];
    chrome.notifications.clear(NOTIF_ID);
    return;
  }
  const who = state.name || state.number || 'Desconhecido';
  const incoming = state.direction === 'inbound' && (state.callStatus === 'ringing' || state.isRing);
  const icon = chrome.runtime.getURL('icon-128.png');

  if (incoming) {
    notifButtons = ['answer', 'reject'];
    chrome.notifications.create(NOTIF_ID, {
      type: 'basic',
      iconUrl: icon,
      title: who,
      message: 'Chamada recebida',
      priority: 2,
      requireInteraction: true,
      buttons: [{ title: 'Atender' }, { title: 'Recusar' }],
    });
  } else {
    const label = state.callStatus === 'talking' ? 'Em conversa' : 'Chamando…';
    notifButtons = ['hangup'];
    chrome.notifications.create(NOTIF_ID, {
      type: 'basic',
      iconUrl: icon,
      title: who,
      message: label,
      priority: 1,
      requireInteraction: true,
      buttons: [{ title: 'Desligar' }],
    });
  }
}

chrome.notifications.onButtonClicked.addListener((id, index) => {
  if (id !== NOTIF_ID) return;
  const action = notifButtons[index];
  if (action) {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'CALL_ACTION', action }).catch(() => {});
  }
});

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

// ---------- Login integrado ----------
// Observa as requisições do Comunic Chat para a API da Helena e captura o Bearer
// do usuário. Esse token é enviado uma vez ao backend, que valida a identidade,
// localiza o ramal vinculado e devolve a assinatura — o ramal registra sozinho.
let lastHelenaAuth = '';

async function loginIntegrado(helenaToken: string): Promise<void> {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  console.log('[Comunic.SIP][login] token capturado; backendUrl =', backendUrl, '| status =', lastStatus.status);
  if (!backendUrl) { console.log('[Comunic.SIP][login] sem backendUrl configurado — ignorando'); return; }
  // Já conectado/conectando? Não refaz.
  if (lastStatus.status === 'registered' || lastStatus.status === 'connecting') return;
  console.log('[Comunic.SIP][login] chamando', `${String(backendUrl).replace(/\/+$/, '')}/v1/auth/extension`);

  lastStatus = { status: 'connecting', detail: 'Login integrado…' };
  broadcastToPopup({ target: 'popup', type: 'STATUS', status: 'connecting', detail: 'Login integrado…' });

  try {
    const res = await fetch(`${String(backendUrl).replace(/\/+$/, '')}/v1/auth/extension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helenaToken }),
    });
    if (!res.ok) {
      const txt = await res.text();
      lastStatus = { status: 'failed', detail: `Backend ${res.status}` };
      broadcastToPopup({ target: 'popup', type: 'STATUS', status: 'failed', detail: `Backend ${res.status}: ${txt}` });
      return;
    }
    const data = (await res.json()) as { extension: string; pbxUrl: string; sign: string };
    console.log('[Comunic.SIP][login] backend OK — ramal', data.extension);
    const config = { pbxURL: data.pbxUrl, extension: data.extension, signature: data.sign };
    await chrome.storage.local.set(config);
    await ensureOffscreen();
    sendToOffscreen({ target: 'offscreen', type: 'INIT', config });
  } catch (e: any) {
    lastStatus = { status: 'failed', detail: 'Backend inacessível' };
    broadcastToPopup({ target: 'popup', type: 'STATUS', status: 'failed', detail: 'Backend inacessível: ' + String(e?.message ?? e) });
  }
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const auth = details.requestHeaders?.find((h) => h.name.toLowerCase() === 'authorization');
    const val = auth?.value;
    if (val && val.startsWith('Bearer ') && val !== lastHelenaAuth) {
      console.log('[Comunic.SIP][login] Bearer visto em', details.url);
      lastHelenaAuth = val;
      loginIntegrado(val.slice(7));
    }
  },
  { urls: ['https://api.wts.chat/*', 'https://api.flw.chat/*'] },
  ['requestHeaders', 'extraHeaders'],
);
console.log('[Comunic.SIP][login] observador de token ativo');

function notifyIncoming(state: CallState): void {
  if (state.active && state.direction === 'inbound' && (state.callStatus === 'ringing' || state.isRing)) {
    chrome.action.setBadgeText({ text: '●' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }).catch(() => {});
  } else if (!state.active) {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
  }
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
      case 'CALL_ACTION': {
        sendToOffscreen({ target: 'offscreen', type: 'CALL_ACTION', action: raw.action, digit: raw.digit, arg: raw.arg });
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
        sendResponse({ ...lastStatus, callState: lastCallState });
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
      case 'CALL_STATE': {
        lastCallState = raw.state;
        trackCall(raw.state);
        notifyIncoming(raw.state);
        updateCallNotification(raw.state);
        broadcastToPopup({ target: 'popup', type: 'CALL_STATE', state: raw.state });
        break;
      }
    }
  })();

  // Mantém o canal aberto para respostas assíncronas (GET_STATUS).
  return true;
});
