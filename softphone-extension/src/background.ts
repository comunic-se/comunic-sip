// Service worker: orquestra. Cria/garante o offscreen, repassa mensagens
// entre popup e offscreen e guarda o último status de registro e da chamada.
import type { AnyMessage, CallState, RegSnapshot, StatusSnapshot, SdkConfig } from './shared/messages';
import { toDialable, formatBR } from './shared/phone';
import { BACKEND_URL } from './shared/config';
import { DEFAULT_AUDIO, type AudioSettings } from './shared/audio';

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
      // Sem o "plim" do sistema: quem toca é a extensão (som de telefone, em loop).
      silent: true,
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
      silent: true,
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

// ---------- Ajustes de áudio ----------
// Ficam em chrome.storage.local (o offscreen não acessa storage): o offscreen pede
// com GET_AUDIO ao iniciar, e cada mudança feita no popup é repassada a ele.
async function loadAudio(): Promise<AudioSettings> {
  const { audio } = await chrome.storage.local.get('audio');
  return { ...DEFAULT_AUDIO, ...(audio ?? {}) };
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.audio) return;
  chrome.offscreen.hasDocument?.().then((has) => {
    if (has) loadAudio().then((audio) => sendToOffscreen({ target: 'offscreen', type: 'AUDIO_SETTINGS', audio }));
  });
});

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

type AuthResponse = { extension: string; pbxUrl: string; sign: string; signExpiresAt?: number; token?: string };

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

// ---------- Sessão do Comunic Chat (token da Helena) ----------
// O token de acesso vale ~1 h; a página o renova sozinha. Recebemos o vigente de
// três fontes: o monitor de sessão nas abas (content script), o pedido direto à
// aba quando o guardado venceu e as requisições observadas (webRequest).
const COMUNIC_PAGES = ['https://*.wts.chat/*', 'https://*.flw.chat/*'];

function jwtExp(token: string): number | undefined {
  try {
    const json = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : undefined;
  } catch {
    return undefined;
  }
}

async function storeHelenaToken(token: string, expiresAt?: number): Promise<boolean> {
  const { helenaToken } = await chrome.storage.session.get('helenaToken');
  if (helenaToken === token) return false;
  await chrome.storage.session.set({ helenaToken: token, helenaTokenExp: expiresAt ?? jwtExp(token) ?? 0 });
  return true;
}

/** Pede o token atual às abas abertas do Comunic Chat. */
async function tokenFromTabs(): Promise<string | null> {
  const tabs = await chrome.tabs.query({ url: COMUNIC_PAGES }).catch(() => [] as chrome.tabs.Tab[]);
  let best: { token: string; expiresAt?: number } | null = null;
  for (const t of tabs) {
    if (t.id == null) continue;
    const r = (await chrome.tabs.sendMessage(t.id, { target: 'content', type: 'GET_HELENA_SESSION' }).catch(() => null)) as
      { token?: string; expiresAt?: number } | null;
    if (r?.token && (!best || (r.expiresAt ?? 0) > (best.expiresAt ?? 0))) best = { token: r.token, expiresAt: r.expiresAt };
  }
  if (!best) return null;
  await storeHelenaToken(best.token, best.expiresAt);
  return best.token;
}

/** Token vigente: o guardado, se ainda vale por mais de 1 min; senão, o da aba aberta. */
async function freshHelenaToken(): Promise<string | null> {
  const { helenaToken, helenaTokenExp } = await chrome.storage.session.get(['helenaToken', 'helenaTokenExp']);
  const exp = Number(helenaTokenExp) || 0;
  if (helenaToken && (!exp || exp - 60 > Date.now() / 1000)) return String(helenaToken);
  return (await tokenFromTabs()) ?? (helenaToken ? String(helenaToken) : null);
}

// ---------- Watchdog do ramal ----------
// Enquanto houver sessão do Comunic Chat, o ramal tem que estar registrado.
// Roda a cada minuto (alarme), quando chega token novo, quando o registro falha
// e quando a assinatura está para vencer. Não reinicia o SDK se já está tudo bem
// nem durante uma chamada.
const CONNECTING_GRACE_MS = 90_000; // dá tempo ao SDK de reconectar sozinho
// Entre tentativas: 30 s, dobrando a cada falha seguida até 10 min (o backend
// limita o login a 20/min por sessão; falha em série não pode martelar).
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;
let connectingSince = 0;
let lastAttemptAt = 0;
let failStreak = 0;
const retryDelay = () => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** failStreak);
let ensuring = false;

/** Estado real, perguntado a quem mantém o registro (o offscreen). */
async function regSnapshot(): Promise<RegSnapshot> {
  const has = await chrome.offscreen.hasDocument?.();
  if (!has) return { status: 'idle', busy: false };
  const r = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'GET_REG' }).catch(() => null)) as RegSnapshot | null;
  return r ?? { status: 'idle', busy: false };
}

async function ensureConnected(reason: string, force = false): Promise<void> {
  if (ensuring) return;
  ensuring = true;
  try {
    const reg = await regSnapshot();
    if (reg.busy) return; // nunca derruba chamada; a renovação pendente é aplicada ao fim dela
    const expiring = await signatureExpiringSoon();
    if (reg.status === 'registered' && !expiring && !force) { connectingSince = 0; failStreak = 0; return; }
    if (reg.status === 'connecting' && !expiring && !force) {
      if (!connectingSince) connectingSince = Date.now();
      if (Date.now() - connectingSince < CONNECTING_GRACE_MS) return;
    }
    if (!force && Date.now() - lastAttemptAt < retryDelay()) return;

    let token = await freshHelenaToken();
    if (!token) return; // sem Comunic Chat aberto/logado: nada a fazer até ele abrir
    lastAttemptAt = Date.now();
    failStreak++; // zera quando o ramal registra
    console.log('[Comunic.SIP][watchdog] reconectando —', reason, '· status', reg.status, expiring ? '· assinatura vencendo' : '');

    let r = await authExtension(BACKEND_URL, token);
    if (!r.ok && r.status === 401) {
      // Token da Helena vencido: pega o atual na aba e tenta de novo.
      await chrome.storage.session.remove(['helenaToken', 'helenaTokenExp']);
      token = await tokenFromTabs();
      if (token) r = await authExtension(BACKEND_URL, token);
    }
    if (!r.ok) {
      console.log('[Comunic.SIP][watchdog] backend recusou:', r.status, r.text);
      if (reg.status !== 'registered') {
        lastStatus = { status: 'failed', detail: r.status === 401 ? 'Sessão do Comunic Chat expirada — atualize a página' : `Backend ${r.status}` };
        broadcastToPopup({ target: 'popup', type: 'STATUS', ...lastStatus });
      }
      return;
    }
    connectingSince = 0;
    await ensureOffscreen();
    sendToOffscreen({ target: 'offscreen', type: 'RENEW', config: r.config });
  } catch (e) {
    console.log('[Comunic.SIP][watchdog] falhou:', e);
  } finally {
    ensuring = false;
  }
}

async function renewSignature(): Promise<void> {
  await ensureConnected('renovação da assinatura', true);
  // Se não deu (sem sessão/sem rede), o watchdog de 1 min tenta de novo.
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
chrome.runtime.onInstalled.addListener(() => {
  // Abas do Comunic Chat já abertas não recebem o content script novo até recarregar:
  // injeta o monitor de sessão nelas agora.
  chrome.tabs.query({ url: COMUNIC_PAGES }).then((tabs) => {
    for (const t of tabs) {
      if (t.id != null) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['session-watch.js'] }).catch(() => {});
    }
  }).catch(() => {});
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
  if (alarm.name === PRESENCE_ALARM) ensureConnected('verificação periódica').finally(presenceTick);
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const auth = details.requestHeaders?.find((h) => h.name.toLowerCase() === 'authorization');
    const val = auth?.value;
    if (val && val.startsWith('Bearer ') && val !== lastHelenaAuth) {
      lastHelenaAuth = val;
      storeHelenaToken(val.slice(7)).then((changed) => { if (changed) ensureConnected('token captado'); });
    }
  },
  { urls: ['https://api.wts.chat/*', 'https://api.flw.chat/*'] },
  ['requestHeaders', 'extraHeaders'],
);
console.log('[Comunic.SIP][login] observador de token ativo');
ensureConnected('service worker iniciado');

// ---------- Ponte com o painel de gestão ----------
// O painel (página servida pelo backend) pede a sessão à extensão, que usa o
// Bearer já capturado da Helena para abrir a sessão do painel no backend.
// Assim o gestor não precisa colar token nenhum.
async function getPanelSession(): Promise<unknown> {
  const helenaToken = await freshHelenaToken();
  if (!helenaToken) return { error: 'sessão do Comunic Chat ainda não captada — abra/atualize o Comunic Chat' };
  const res = await fetch(`${BACKEND_URL}/v1/panel/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ helenaToken }),
  });
  return res.json();
}

// Segurança: só a página servida pelo PRÓPRIO backend configurado (onde o painel mora)
// recebe a sessão. O manifest (externally_connectable) já limita os domínios; aqui
// conferimos a origem exata, então nem outro site do mesmo domínio consegue pedir.
async function trustedPanelOrigin(sender: chrome.runtime.MessageSender): Promise<boolean> {
  const expected = new URL(BACKEND_URL).origin;
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : '');
  return origin === expected;
}

chrome.runtime.onMessageExternal.addListener((msg: any, sender, sendResponse) => {
  if (msg?.type === 'PANEL_SESSION') {
    trustedPanelOrigin(sender)
      .then((ok) => {
        if (!ok) {
          console.warn('[Comunic.SIP][painel] pedido de sessão recusado de', sender.origin ?? sender.url);
          sendResponse({ error: 'origem não autorizada' });
          return;
        }
        return getPanelSession().then(sendResponse);
      })
      .catch((e) => sendResponse({ error: String(e?.message ?? e) }));
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
  let jwt = await ensurePanelJwt();
  if (!jwt) return { error: 'Abra o Comunic Chat para carregar seus contatos.' };
  const base = BACKEND_URL;
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
      case 'GET_AUDIO': {
        sendResponse(await loadAudio());
        return;
      }
      case 'TEST_SOUND': {
        await ensureOffscreen();
        sendToOffscreen({ target: 'offscreen', type: 'TEST_SOUND', kind: raw.kind, audio: await loadAudio() });
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
        // O Chrome suspende o background e ele esquece o estado: pergunta ao offscreen.
        const reg = await regSnapshot();
        if (reg.status !== 'idle' || lastStatus.status === 'idle') {
          lastStatus = { status: reg.status, detail: reg.detail ?? (reg.status === lastStatus.status ? lastStatus.detail : undefined) };
        }
        if (reg.callState) lastCallState = reg.callState;
        sendResponse({ ...lastStatus, callState: lastCallState });
        if (reg.status !== 'registered') ensureConnected('popup aberto');
        return;
      }
      case 'HELENA_SESSION': {
        const changed = await storeHelenaToken(raw.token, raw.expiresAt);
        ensureConnected(changed ? 'token novo da aba' : 'aba do Comunic Chat ativa');
        break;
      }
      case 'STATUS': {
        lastStatus = { status: raw.status, detail: raw.detail };
        if (raw.status === 'registered') reportPresence('online', true);
        else if (raw.status === 'failed' || raw.status === 'idle') reportPresence('offline', true);
        if (raw.status === 'registered') { connectingSince = 0; failStreak = 0; }
        if (raw.status === 'connecting' && !connectingSince) connectingSince = Date.now();
        if (raw.status === 'failed') ensureConnected('registro falhou');
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
