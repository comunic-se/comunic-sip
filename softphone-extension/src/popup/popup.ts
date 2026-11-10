// Popup no estilo Comunic Phone: abas (Teclado/Contatos/Histórico/Mensagens),
// cabeçalho com status, discador com teclado e telas de chamada.
import type {
  AnyMessage,
  CallAction,
  CallState,
  HistoryItem,
  RegStatus,
  SdkConfig,
  StatusSnapshot,
} from '../shared/messages';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const PHONE_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z"/></svg>';

const statusDot = $('status-dot');
const appbarTitle = $('appbar-title');
const statusSub = $('status-sub');

const dialInput = $<HTMLInputElement>('dial-input');
const dialerMsg = $('dialer-msg');
const callBtn = $<HTMLButtonElement>('call-btn');

const incomingView = $('incoming-view');
const incallView = $('incall-view');
const incNumber = $('inc-number');
const incAvatar = $('inc-avatar');
const icNumber = $('ic-number');
const icStatus = $('ic-status');
const icTimer = $('ic-timer');
const icAvatar = $('ic-avatar');
const muteBtn = $<HTMLButtonElement>('mute-btn');
const muteLabel = $('mute-label');
const holdBtn = $<HTMLButtonElement>('hold-btn');
const holdLabel = $('hold-label');
const dtmfBtn = $<HTMLButtonElement>('dtmf-btn');
const dtmfPad = $('dtmf-pad');

const VIEWS = ['teclado', 'contatos', 'historico', 'mensagens', 'settings'] as const;
type ViewName = (typeof VIEWS)[number];

const STATUS_LABEL: Record<RegStatus, string> = {
  idle: 'Desconectado',
  connecting: 'Conectando…',
  registered: 'Disponível',
  failed: 'Falha',
};
const CALL_LABEL: Record<string, string> = {
  calling: 'Chamando…',
  ringing: 'Tocando…',
  connecting: 'Conectando…',
  talking: 'Em conversa',
};

let extensionNumber = '';
let timerInterval: number | undefined;

// ---------- Navegação entre views ----------
function showView(name: ViewName): void {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', (t as HTMLElement).dataset.tab === name);
  });
  if (name === 'historico') loadHistory();
}

// ---------- Histórico (CDR) ----------
function formatHistTime(ts: number): string {
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime()) || ms === 0) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function formatDur(sec?: number): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function renderHistory(items: HistoryItem[]): void {
  const list = $('history-list');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty">Sem chamadas recentes.</div>';
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'hist-row';

    const dir = document.createElement('span');
    dir.className = 'hist-dir';
    if (it.direction === 'missed') { dir.textContent = '✕'; dir.style.color = 'var(--hangup)'; }
    else if (it.direction === 'inbound') { dir.textContent = '↙'; dir.style.color = '#1d4ed8'; }
    else { dir.textContent = '↗'; dir.style.color = 'var(--call)'; }

    const main = document.createElement('div');
    main.className = 'hist-main';
    const name = document.createElement('div');
    name.className = 'hist-name';
    name.textContent = it.name || it.number || 'Desconhecido';
    const meta = document.createElement('div');
    meta.className = 'hist-meta';
    const dur = formatDur(it.talkDuration);
    meta.textContent = [formatHistTime(it.timestamp), dur].filter(Boolean).join(' · ');
    main.append(name, meta);

    const call = document.createElement('button');
    call.className = 'hist-call';
    call.innerHTML = PHONE_SVG;
    call.title = 'Ligar';
    call.addEventListener('click', () => {
      if (it.number) chrome.runtime.sendMessage({ target: 'background', type: 'CALL', number: it.number });
    });

    row.append(dir, main, call);
    list.appendChild(row);
  }
}
async function loadHistory(): Promise<void> {
  const list = $('history-list');
  list.innerHTML = '<div class="empty">Carregando…</div>';
  try {
    const items = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'GET_HISTORY' })) as
      | HistoryItem[]
      | undefined;
    renderHistory(items ?? []);
  } catch {
    list.innerHTML = '<div class="empty">Conecte o ramal para ver o histórico.</div>';
  }
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => showView((t as HTMLElement).dataset.tab as ViewName));
});
$('settings-btn').addEventListener('click', () => {
  const settingsOpen = !$('view-settings').hidden;
  showView(settingsOpen ? 'teclado' : 'settings');
});

// ---------- Status de registro ----------
let lastRegStatus: RegStatus = 'idle';
let lastRegDetail: string | undefined;

function renderStatus(status: RegStatus, detail?: string): void {
  lastRegStatus = status;
  lastRegDetail = detail;
  statusDot.className = `dot dot--${status}`;
  appbarTitle.textContent = extensionNumber ? `Ramal ${extensionNumber}` : 'Comunic.SIP';
  statusSub.textContent = detail || STATUS_LABEL[status];
  callBtn.disabled = status !== 'registered';
}

// Status fino durante a chamada (cabeçalho).
function setHeaderForCall(state: CallState): void {
  if (!state.active) {
    renderStatus(lastRegStatus, lastRegDetail);
    return;
  }
  const incoming = state.direction === 'inbound' && (state.callStatus === 'ringing' || state.isRing);
  const label = incoming ? 'Chamada recebida' : (CALL_LABEL[state.callStatus ?? ''] ?? 'Em ligação');
  statusDot.className = state.callStatus === 'talking' ? 'dot dot--registered' : 'dot dot--connecting';
  statusSub.textContent = label;
}

// ---------- Cronômetro / avatar ----------
function formatElapsed(startMs: number): string {
  const total = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function stopTimer(): void {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = undefined; }
}
function initial(text?: string): string {
  const t = (text || '').trim();
  return t ? t[0].toUpperCase() : '?';
}

// ---------- Telas de chamada ----------
function renderCall(state: CallState): void {
  setHeaderForCall(state);

  const active = state.active;
  const incoming = active && state.direction === 'inbound'
    && (state.callStatus === 'ringing' || state.isRing);
  const transferring = !!state.transferring;

  incomingView.hidden = !incoming;
  incallView.hidden = !active || incoming;

  const who = state.name || state.number || 'Desconhecido';

  if (incoming) {
    incNumber.textContent = who;
    incAvatar.textContent = initial(who);
  }

  // Alterna entre controles normais e o modo de consulta (transferência assistida).
  $('ctrl-grid').hidden = transferring;
  $('incall-actions').hidden = transferring;
  $('consult-actions').hidden = !transferring;
  if (transferring) { dtmfPad.hidden = true; transferPanel.hidden = true; }

  if (active && !incoming) {
    if (transferring) {
      icNumber.textContent = state.transferTarget || who;
      icAvatar.textContent = initial(state.transferTarget || who);
      icStatus.textContent = 'Consultando…';
      stopTimer();
      icTimer.textContent = '';
    } else {
      icNumber.textContent = who;
      icAvatar.textContent = initial(who);
      icStatus.textContent = CALL_LABEL[state.callStatus ?? ''] ?? '';

      muteLabel.textContent = state.isMute ? 'Ativar' : 'Mudo';
      muteBtn.classList.toggle('active', !!state.isMute);
      holdLabel.textContent = state.isHold ? 'Retomar' : 'Espera';
      holdBtn.classList.toggle('active', !!state.isHold);

      stopTimer();
      if (state.callStatus === 'talking' && state.callStartTime) {
        const start = state.callStartTime;
        icTimer.textContent = formatElapsed(start);
        timerInterval = setInterval(() => { icTimer.textContent = formatElapsed(start); }, 1000) as unknown as number;
      } else {
        icTimer.textContent = '';
      }
    }
  } else if (!active) {
    stopTimer();
    dtmfPad.hidden = true;
    transferPanel.hidden = true;
  }
}

// ---------- Mensageria ----------
function action(a: CallAction, digit?: string, arg?: string): void {
  chrome.runtime.sendMessage({ target: 'background', type: 'CALL_ACTION', action: a, digit, arg });
}

// ---------- Teclado ----------
document.querySelectorAll('.key').forEach((k) => {
  k.addEventListener('click', () => {
    const digit = (k as HTMLElement).dataset.k ?? '';
    if (!incallView.hidden) {
      action('dtmf', digit); // em chamada, o teclado manda DTMF
    } else {
      dialInput.value += digit;
    }
  });
});
callBtn.addEventListener('click', () => {
  const number = dialInput.value.trim();
  if (!number) return;
  chrome.runtime.sendMessage({ target: 'background', type: 'CALL', number });
});

// ---------- Controles da chamada ----------
$('answer-btn').addEventListener('click', () => action('answer'));
$('reject-btn').addEventListener('click', () => action('reject'));
$('hangup-btn').addEventListener('click', () => action('hangup'));
muteBtn.addEventListener('click', () => action(muteBtn.classList.contains('active') ? 'unmute' : 'mute'));
holdBtn.addEventListener('click', () => action(holdBtn.classList.contains('active') ? 'unhold' : 'hold'));
const transferPanel = $('transfer-panel');
const transferInput = $<HTMLInputElement>('transfer-input');

dtmfBtn.addEventListener('click', () => {
  transferPanel.hidden = true;
  dtmfPad.hidden = !dtmfPad.hidden;
  if (!dtmfPad.hidden) dtmfPad.scrollIntoView({ block: 'nearest' });
});
$('transfer-btn').addEventListener('click', () => {
  dtmfPad.hidden = true;
  transferPanel.hidden = !transferPanel.hidden;
  if (!transferPanel.hidden) {
    transferPanel.scrollIntoView({ block: 'nearest' });
    transferInput.focus();
  }
});
$('transfer-do').addEventListener('click', () => {
  const dest = transferInput.value.trim();
  if (!dest) return;
  action('blindTransfer', undefined, dest);
  transferInput.value = '';
  transferPanel.hidden = true;
});
$('consult-btn').addEventListener('click', () => {
  const dest = transferInput.value.trim();
  if (!dest) return;
  action('consult', undefined, dest);
  transferInput.value = '';
  transferPanel.hidden = true;
});
$('complete-transfer-btn').addEventListener('click', () => action('completeTransfer'));
$('cancel-transfer-btn').addEventListener('click', () => action('cancelTransfer'));

for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']) {
  const b = document.createElement('button');
  b.textContent = d;
  b.addEventListener('click', () => action('dtmf', d));
  dtmfPad.appendChild(b);
}

// ---------- Ajustes ----------
async function loadSettings(): Promise<void> {
  const s = await chrome.storage.local.get(['pbxURL', 'extension', 'signature', 'backendUrl']);
  $<HTMLInputElement>('pbx-url').value = s.pbxURL ?? '';
  $<HTMLInputElement>('extension').value = s.extension ?? '';
  $<HTMLTextAreaElement>('signature').value = s.signature ?? '';
  $<HTMLInputElement>('backend-url').value = s.backendUrl ?? '';
  extensionNumber = s.extension ?? '';
}

$<HTMLButtonElement>('integ-btn').addEventListener('click', async () => {
  const msg = $('settings-msg');
  const url = $<HTMLInputElement>('backend-url').value.trim();
  if (!url) { msg.textContent = 'Informe a URL do backend.'; return; }
  // Padrão de permissão NÃO pode conter porta → usa protocolo + host.
  let backendPattern: string;
  try {
    const u = new URL(url);
    backendPattern = `${u.protocol}//${u.hostname}/*`;
  } catch { msg.textContent = 'URL do backend inválida.'; return; }
  try {
    // Origem do backend + acesso ao PBX (origem decidida pelo backend).
    const granted = await chrome.permissions.request({ origins: [backendPattern, 'https://*/*'] });
    if (!granted) { msg.textContent = 'Permissão negada.'; return; }
  } catch (e: any) {
    msg.textContent = 'Erro ao pedir permissão: ' + String(e?.message ?? e);
    return;
  }
  await chrome.storage.local.set({ backendUrl: url });
  msg.textContent = 'Login integrado ativado. Abra o Comunic Chat para registrar o ramal.';
});

$<HTMLButtonElement>('connect-btn').addEventListener('click', async () => {
  const config: SdkConfig = {
    pbxURL: $<HTMLInputElement>('pbx-url').value.trim(),
    extension: $<HTMLInputElement>('extension').value.trim(),
    signature: $<HTMLTextAreaElement>('signature').value.trim(),
  };
  if (!config.pbxURL || !config.extension || !config.signature) {
    renderStatus('failed', 'Preencha URL, ramal e assinatura.');
    showView('settings');
    return;
  }
  let origin: string;
  try { origin = new URL(config.pbxURL).origin + '/*'; }
  catch { renderStatus('failed', 'URL do PBX inválida.'); return; }
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) { renderStatus('failed', 'Permissão de acesso ao PBX negada.'); return; }

  await chrome.storage.local.set(config);
  extensionNumber = config.extension;
  renderStatus('connecting');
  showView('teclado');
  chrome.runtime.sendMessage({ target: 'background', type: 'INIT_SDK', config });
});

// ---------- Eventos do background ----------
chrome.runtime.onMessage.addListener((raw: AnyMessage) => {
  if (raw.target !== 'popup') return;
  if (raw.type === 'STATUS') {
    renderStatus(raw.status, raw.detail);
  } else if (raw.type === 'CALL_STATE') {
    renderCall(raw.state);
  } else if (raw.type === 'CALL_EVENT') {
    const info = raw.call?.state ?? raw.call?.number ?? '';
    if (info) dialerMsg.textContent = `${raw.event}: ${info}`;
  }
});

// ---------- Inicialização ----------
(async () => {
  await loadSettings();
  const snap = (await chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATUS' })) as
    | StatusSnapshot
    | undefined;
  renderStatus(snap?.status ?? 'idle', snap?.detail);
  renderCall(snap?.callState ?? { active: false });
  if (!extensionNumber) showView('settings');
})();
