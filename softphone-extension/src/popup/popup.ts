// Popup no estilo Comunic Phone: abas (Teclado/Contatos/Histórico),
// cabeçalho com status, discador com teclado e telas de chamada.
import type {
  AnyMessage,
  CallAction,
  CallState,
  Contact,
  HistoryItem,
  RegStatus,
  SdkConfig,
  StatusSnapshot,
} from '../shared/messages';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const PENCIL_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.931-8.931z"/></svg>';

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

const VIEWS = ['teclado', 'contatos', 'historico', 'settings'] as const;
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
  if (name === 'contatos') loadContacts();
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
  if (state.active) dialerMsg.textContent = '';

  const active = state.active;
  const incoming = !!(active && state.direction === 'inbound'
    && (state.callStatus === 'ringing' || state.isRing));
  const transferring = !!state.transferring;

  incomingView.hidden = !incoming;
  incallView.hidden = !active || incoming;
  document.body.classList.toggle('in-call', active);

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
      syncBackspace();
    }
  });
});
// ---------- Apagar ----------
// Clique: apaga o último dígito. Segurar (600 ms): limpa o número inteiro.
const HOLD_MS = 600;

/** Liga um botão de apagar a um campo e devolve a função que atualiza sua visibilidade. */
function wireBackspace(btn: HTMLButtonElement, input: HTMLInputElement): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heldLong = false;
  const sync = () => btn.classList.toggle('is-empty', input.value.length === 0);
  const cancel = () => { if (timer) clearTimeout(timer); timer = undefined; };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // não tira o foco do campo
    heldLong = false;
    cancel();
    timer = setTimeout(() => { heldLong = true; timer = undefined; input.value = ''; sync(); }, HOLD_MS);
  });
  btn.addEventListener('pointerup', () => {
    cancel();
    if (!heldLong) { input.value = input.value.slice(0, -1); sync(); }
  });
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  input.addEventListener('input', sync);
  sync();
  return sync;
}
const syncBackspace = wireBackspace($<HTMLButtonElement>('backspace-btn'), dialInput);

callBtn.addEventListener('click', () => {
  const number = dialInput.value.trim();
  if (!number) return;
  dialerMsg.textContent = '';
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
const syncXferBackspace = wireBackspace($<HTMLButtonElement>('transfer-backspace'), transferInput);
function closeTransfer(): void {
  transferInput.value = '';
  syncXferBackspace();
  transferPanel.hidden = true;
}
$('transfer-btn').addEventListener('click', () => {
  dtmfPad.hidden = true;
  if (!transferPanel.hidden) { closeTransfer(); return; }
  transferPanel.hidden = false;
  transferInput.focus();
});
$('transfer-cancel').addEventListener('click', closeTransfer);
transferInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('transfer-do').click(); });

// Teclado da transferência: mesmo layout do teclado inicial (dígitos + letras).
const PAD: [string, string][] = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', ''],
];
const transferPad = $('transfer-pad');
for (const [d, letters] of PAD) {
  const b = document.createElement('button');
  b.className = 'key';
  b.innerHTML = `<b>${d}</b><s>${letters}</s>`;
  b.addEventListener('pointerdown', (e) => e.preventDefault()); // mantém o foco no campo
  b.addEventListener('click', () => { transferInput.value += d; syncXferBackspace(); });
  transferPad.appendChild(b);
}
$('transfer-do').addEventListener('click', () => {
  const dest = transferInput.value.trim();
  if (!dest) return;
  action('blindTransfer', undefined, dest);
  closeTransfer();
});
$('consult-btn').addEventListener('click', () => {
  const dest = transferInput.value.trim();
  if (!dest) return;
  action('consult', undefined, dest);
  closeTransfer();
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
    // Só erros aparecem pro usuário; o andamento já está no cabeçalho e na tela de chamada.
    if (raw.event === 'error') dialerMsg.textContent = String(raw.call?.state ?? 'Falha na chamada');
  }
});

// ---------- Contatos ----------
const ctSearch = $<HTMLInputElement>('ct-search');
const ctList = $('ct-list');
const ctForm = $('ct-form');
const ctFormTitle = $('ct-form-title');
const ctName = $<HTMLInputElement>('ct-name');
const ctPhone = $<HTMLInputElement>('ct-phone');
const ctEmail = $<HTMLInputElement>('ct-email');
const ctMsg = $('ct-msg');
let ctEditId: string | undefined;
let ctSearchTimer: number | undefined;

function openContactForm(c?: Contact): void {
  ctEditId = c?.id;
  ctFormTitle.textContent = c?.id ? 'Editar contato' : 'Novo contato';
  ctName.value = c?.name ?? '';
  ctPhone.value = c ? contactNumber(c) : '';
  ctEmail.value = c?.email ?? '';
  ctMsg.textContent = '';
  ctForm.hidden = false;
  ctName.focus();
}
function closeContactForm(): void { ctForm.hidden = true; ctEditId = undefined; }

// Número limpo para discar: tira o prefixo "+55|" e deixa só dígitos.
function contactNumber(c: Contact): string {
  const raw = c.phoneNumber || '';
  if (!raw) return '';
  const national = raw.includes('|') ? (raw.split('|').pop() || '') : raw;
  return national.replace(/\D/g, '');
}

function renderContacts(items: Contact[]): void {
  ctList.innerHTML = '';
  if (!items.length) { ctList.innerHTML = '<div class="empty">Nenhum contato.</div>'; return; }
  for (const c of items) {
    const row = document.createElement('div');
    row.className = 'ct-row';
    const main = document.createElement('div');
    main.className = 'ct-main';

    const nm = document.createElement('div'); nm.className = 'ct-name';
    nm.textContent = c.name || 'Sem nome';

    const num = contactNumber(c);
    const ph = document.createElement('div'); ph.className = 'ct-meta';
    ph.textContent = c.phoneNumberFormatted || num || 'Sem telefone';
    if (!num) ph.classList.add('ct-empty');
    main.append(nm, ph);

    if (c.email) {
      const em = document.createElement('div'); em.className = 'ct-meta';
      em.textContent = c.email;
      main.append(em);
    }

    const editB = document.createElement('button');
    editB.className = 'ct-iconbtn'; editB.title = 'Editar';
    editB.innerHTML = PENCIL_SVG;
    editB.addEventListener('click', () => openContactForm(c));

    const callB = document.createElement('button');
    callB.className = 'hist-call'; callB.innerHTML = PHONE_SVG;
    if (num) {
      callB.title = 'Ligar';
      callB.addEventListener('click', () => chrome.runtime.sendMessage({ target: 'background', type: 'CALL', number: num }));
    } else {
      callB.title = 'Sem telefone cadastrado';
      callB.disabled = true;
    }

    row.append(main, editB, callB);
    ctList.appendChild(row);
  }
}

async function loadContacts(): Promise<void> {
  ctList.innerHTML = '<div class="empty">Carregando…</div>';
  const resp = (await chrome.runtime.sendMessage({ target: 'background', type: 'CONTACTS_SEARCH', query: ctSearch.value.trim() })) as
    | { items?: Contact[]; error?: string }
    | undefined;
  if (!resp || resp.error) { renderContacts([]); ctList.innerHTML = `<div class="empty">${resp?.error ?? 'Falha ao buscar contatos.'}</div>`; return; }
  renderContacts(resp.items ?? []);
}

ctSearch.addEventListener('input', () => {
  if (ctSearchTimer) clearTimeout(ctSearchTimer);
  ctSearchTimer = setTimeout(() => loadContacts(), 350) as unknown as number;
});
$('ct-new').addEventListener('click', () => openContactForm());
$('ct-cancel').addEventListener('click', closeContactForm);
$('ct-save').addEventListener('click', async () => {
  const contact: Contact = {
    id: ctEditId,
    name: ctName.value.trim(),
    phoneNumber: ctPhone.value.trim(),
    email: ctEmail.value.trim() || undefined,
  };
  if (!contact.name) { ctMsg.textContent = 'Informe o nome.'; return; }
  if (!contact.phoneNumber) { ctMsg.textContent = 'Informe o telefone.'; return; }
  ctMsg.textContent = 'Salvando…';
  const resp = (await chrome.runtime.sendMessage({ target: 'background', type: 'CONTACT_SAVE', contact })) as
    | { error?: string }
    | undefined;
  if (resp && resp.error) { ctMsg.textContent = resp.error; return; }
  closeContactForm();
  await loadContacts();
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
