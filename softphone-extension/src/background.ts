// Service worker: orquestra. Cria/garante o offscreen, repassa mensagens
// entre popup e offscreen e guarda o último status de registro e da chamada.
import type { AnyMessage, CallState, StatusSnapshot, SdkConfig } from './shared/messages';
import { toDialable, formatBR } from './shared/phone';

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

// ---------- Assinatura do SDK com validade ----------
// O backend devolve signExpiresAt (epoch em segundos). Renovamos 15 min antes
// de vencer via chrome.alarms (sobrevive à suspensão do service worker).
const RENEW_ALARM = 'comunic-renew-sign';
const RENEW_MARGIN_S = 15 * 60;
const RENEW_RETRY_MIN = 5;

type AuthResponse = { extension: string; pbxUrl: string; sign: string; signExpiresAt?: number; token?: string };

async function backendBase(): Promise<string | null> {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  return backendUrl ? String(backendUrl).replace(/\/+$/, '') : null;
}

/** Chama /v1/auth/extension e guarda config, validade e JWT. */
async function authExtension(base: string, helenaToken: string): Promise<{ ok: true; config: SdkConfig } | { ok: false; status: number; text: string }> {
  const res = await fetch(`${base}/v1/auth/extension`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ helenaToken }),
  });
  if (!res.ok) return { ok: false, status: res.status, text: await res.text() };
  const data = (await res.json()) as AuthResponse;
  if (data.token) await chrome.storage.session.set({ panelJwt: data.token });
  const config: SdkConfig = { pbxURL: data.pbxUrl, extension: data.extension, signature: data.sign };
  await chrome.storage.local.set({ ...config, signExpiresAt: data.signExpiresAt ?? 0 });
  scheduleRenewal(data.signExpiresAt ?? 0);
  return { ok: true, config };
}

function scheduleRenewal(expiresAt: number): void {
  chrome.alarms.clear(RENEW_ALARM).catch(() => {});
  if (!expiresAt) return; // backend antigo / assinatura sem validade
  const whenMs = Math.max(Date.now() + 60_000, (expiresAt - RENEW_MARGIN_S) * 1000);
  chrome.alarms.create(RENEW_ALARM, { when: whenMs });
  console.log('[Comunic.SIP][sign] renovação agendada para', new Date(whenMs).toLocaleString());
}

/** true se a assinatura salva vence nos próximos 15 min (ou já venceu). */
async function signatureExpiringSoon(): Promise<boolean> {
  const { signExpiresAt } = await chrome.storage.local.get('signExpiresAt');
  if (!signExpiresAt) return false;
  return Number(signExpiresAt) - RENEW_MARGIN_S <= Date.now() / 1000;
}

let renewing = false;
async function renewSignature(): Promise<void> {
  if (renewing) return;
  renewing = true;
  try {
    const base = await backendBase();
    const { helenaToken } = await chrome.storage.session.get('helenaToken');
    if (!base || !helenaToken) {
      // Sem sessão do Comunic Chat (navegador reaberto?). O próximo Bearer captado
      // faz o login integrado de novo; até lá, tenta outra vez mais tarde.
      chrome.alarms.create(RENEW_ALARM, { delayInMinutes: RENEW_RETRY_MIN });
      return;
    }
    const r = await authExtension(base, String(helenaToken));
    if (!r.ok) {
      console.log('[Comunic.SIP][sign] renovação falhou:', r.status);
      chrome.alarms.create(RENEW_ALARM, { delayInMinutes: RENEW_RETRY_MIN });
      return;
    }
    await ensureOffscreen();
    // O offscreen só reinicia o SDK se não houver chamada em andamento.
    sendToOffscreen({ target: 'offscreen', type: 'RENEW', config: r.config });
  } catch (e) {
    console.log('[Comunic.SIP][sign] renovação falhou:', e);
    chrome.alarms.create(RENEW_ALARM, { delayInMinutes: RENEW_RETRY_MIN });
  } finally {
    renewing = false;
  }
}

// ---------- Click-to-call (página do Comunic Chat e menu de clique direito) ----------
/** Disca se o número for válido, o ramal estiver registrado e não houver chamada em andamento. */
async function clickToCall(input: string): Promise<{ ok: boolean; error?: string }> {
  const number = toDialable(input);
  if (!number) return { ok: false, error: 'Isso não parece um telefone válido (use DDD + número).' };
  const has = await chrome.offscreen.hasDocument?.();
  const reg = has
    ? ((await chrome.runtime.sendMessage({ target: 'offscreen', type: 'GET_REG' }).catch(() => null)) as { status?: string; busy?: boolean } | null)
    : null;
  if (reg?.status !== 'registered') return { ok: false, error: 'Seu ramal não está conectado. Abra a extensão Comunic.Chat.' };
  if (reg.busy) return { ok: false, error: 'Você já está em uma ligação. Encerre-a antes de ligar para outro número.' };
  sendToOffscreen({ target: 'offscreen', type: 'CALL', number });
  return { ok: true };
}

const C2C_MENU = 'comunic-c2c';
const COMUNIC_PAGES = ['https://*.wts.chat/*', 'https://*.flw.chat/*'];
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: C2C_MENU, title: 'Ligar para "%s" com Comunic.Chat', contexts: ['selection'], documentUrlPatterns: COMUNIC_PAGES,
  }, () => void chrome.runtime.lastError);
});
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== C2C_MENU || !info.selectionText) return;
  const r = await clickToCall(info.selectionText);
  const n = toDialable(info.selectionText);
  chrome.notifications.create('comunic-c2c', {
    type: 'basic', iconUrl: chrome.runtime.getURL('icon-128.png'),
    title: r.ok ? 'Ligando…' : 'Não foi possível ligar',
    message: r.ok && n ? formatBR(n) : r.error ?? '',
    priority: 1,
  });
});

// ---------- Presença (status "Conectado" no painel) ----------
// Avisa o backend quando o registro muda e a cada minuto enquanto registrado.
// O backend marca "Desconectado" se ficar 2,5 min sem aviso.
const PRESENCE_ALARM = 'comunic-presence';
let lastPresence: 'online' | 'offline' | null = null;

async function reportPresence(status: 'online' | 'offline', force = false): Promise<void> {
  if (!force && status === lastPresence && status === 'offline') return; // offline não precisa repetir
  const r = await backendContacts('/v1/presence', { method: 'POST', body: JSON.stringify({ status }) }).catch(() => null);
  if (r && !r.error) lastPresence = status;
}

/** Pergunta ao offscreen (quem mantém o registro) e avisa o backend. */
async function presenceTick(): Promise<void> {
  const has = await chrome.offscreen.hasDocument?.();
  let status: string = 'idle';
  if (has) {
    const r = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'GET_REG' }).catch(() => null)) as { status?: string } | null;
    status = r?.status ?? 'idle';
  }
  await reportPresence(status === 'registered' ? 'online' : 'offline', status === 'registered');
}

chrome.alarms.get(PRESENCE_ALARM).then((a) => {
  if (!a) chrome.alarms.create(PRESENCE_ALARM, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RENEW_ALARM) renewSignature();
  if (alarm.name === PRESENCE_ALARM) presenceTick();
});

async function loginIntegrado(helenaToken: string): Promise<void> {
  const base = await backendBase();
  if (!base) { console.log('[Comunic.SIP][login] sem backendUrl configurado — ignorando'); return; }
  // Já conectado/conectando com assinatura válida? Não refaz.
  if ((lastStatus.status === 'registered' || lastStatus.status === 'connecting') && !(await signatureExpiringSoon())) return;

  lastStatus = { status: 'connecting', detail: 'Login integrado…' };
  broadcastToPopup({ target: 'popup', type: 'STATUS', status: 'connecting', detail: 'Login integrado…' });

  try {
    const r = await authExtension(base, helenaToken);
    if (!r.ok) {
      lastStatus = { status: 'failed', detail: `Backend ${r.status}` };
      broadcastToPopup({ target: 'popup', type: 'STATUS', status: 'failed', detail: `Backend ${r.status}: ${r.text}` });
      return;
    }
    console.log('[Comunic.SIP][login] backend OK — ramal', r.config.extension);
    await ensureOffscreen();
    sendToOffscreen({ target: 'offscreen', type: 'RENEW', config: r.config });
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
      chrome.storage.session.set({ helenaToken: val.slice(7) }).catch(() => {});
      loginIntegrado(val.slice(7));
    }
  },
  { urls: ['https://api.wts.chat/*', 'https://api.flw.chat/*'] },
  ['requestHeaders', 'extraHeaders'],
);
console.log('[Comunic.SIP][login] observador de token ativo');

// ---------- Ponte com o painel de gestão ----------
// O painel (página servida pelo backend) pede a sessão à extensão, que usa o
// Bearer já capturado da Helena para abrir a sessão do painel no backend.
// Assim o gestor não precisa colar token nenhum.
async function getPanelSession(): Promise<unknown> {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  const { helenaToken } = await chrome.storage.session.get('helenaToken');
  if (!backendUrl) return { error: 'backend não configurado na extensão' };
  if (!helenaToken) return { error: 'sessão do Comunic Chat ainda não captada — abra/atualize o Comunic Chat' };
  const res = await fetch(`${String(backendUrl).replace(/\/+$/, '')}/v1/panel/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ helenaToken }),
  });
  return res.json();
}

chrome.runtime.onMessageExternal.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'PANEL_SESSION') {
    getPanelSession().then(sendResponse).catch((e) => sendResponse({ error: String(e?.message ?? e) }));
    return true; // resposta assíncrona
  }
  return undefined;
});

// ---------- Contatos (via backend) ----------
// Passa pelo backend, que usa o token permanente da empresa (não expira) e é
// server-to-server. NUNCA remove (a API da Helena não tem DELETE).

async function ensurePanelJwt(force = false): Promise<string | null> {
  if (!force) {
    const { panelJwt } = await chrome.storage.session.get('panelJwt');
    if (panelJwt) return panelJwt as string;
  }
  const sess: any = await getPanelSession();
  if (sess?.token) { await chrome.storage.session.set({ panelJwt: sess.token }); return sess.token as string; }
  return null;
}

async function backendContacts(path: string, init: RequestInit): Promise<any> {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  if (!backendUrl) return { error: 'backend não configurado' };
  let jwt = await ensurePanelJwt();
  if (!jwt) return { error: 'Abra o Comunic Chat para carregar seus contatos.' };
  const base = String(backendUrl).replace(/\/+$/, '');
  const call = (t: string) => fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...(init.headers ?? {}) },
  });
  let res = await call(jwt);
  if (res.status === 401) { jwt = await ensurePanelJwt(true); if (jwt) res = await call(jwt); }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) { console.warn('[Comunic.SIP][contatos] backend', res.status, text); return { error: json?.error || `Backend ${res.status}` }; }
  return json ?? {};
}

async function searchContacts(query: string): Promise<any> {
  return backendContacts(`/v1/contacts?query=${encodeURIComponent(query || '')}`, { method: 'GET' });
}

async function saveContact(c: any): Promise<any> {
  if (c.id) return backendContacts(`/v1/contacts/${encodeURIComponent(c.id)}`, { method: 'PUT', body: JSON.stringify(c) });
  return backendContacts('/v1/contacts', { method: 'POST', body: JSON.stringify(c) });
}

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
      case 'CLICK_TO_CALL': {
        sendResponse(await clickToCall(raw.number));
        return;
      }
      case 'DIRECTORY': {
        sendResponse(await backendContacts('/v1/directory', { method: 'GET' }));
        return;
      }
      case 'CONTACTS_SEARCH': {
        sendResponse(await searchContacts(raw.query));
        return;
      }
      case 'CONTACT_SAVE': {
        sendResponse(await saveContact(raw.contact));
        return;
      }
      case 'GET_STATUS': {
        sendResponse({ ...lastStatus, callState: lastCallState });
        return;
      }
      case 'STATUS': {
        lastStatus = { status: raw.status, detail: raw.detail };
        if (raw.status === 'registered') reportPresence('online', true);
        else if (raw.status === 'failed' || raw.status === 'idle') reportPresence('offline', true);
        if (raw.status === 'failed' && (await signatureExpiringSoon())) renewSignature();
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
