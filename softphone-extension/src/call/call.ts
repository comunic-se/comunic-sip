// Janela flutuante de chamada: aparece sozinha quando toca/disca e fecha
// quando a chamada termina. Mesma mensageria do popup (CALL_STATE / CALL_ACTION).
import type { AnyMessage, CallAction, CallState, StatusSnapshot } from '../shared/messages';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const incomingView = $('incoming-view');
const incallView = $('incall-view');
const incNumber = $('inc-number');
const icNumber = $('ic-number');
const icStatus = $('ic-status');
const icTimer = $('ic-timer');
const muteBtn = $<HTMLButtonElement>('mute-btn');
const holdBtn = $<HTMLButtonElement>('hold-btn');
const dtmfBtn = $<HTMLButtonElement>('dtmf-btn');
const dtmfPad = $('dtmf-pad');

const CALL_LABEL: Record<string, string> = {
  calling: 'Chamando…',
  ringing: 'Tocando…',
  connecting: 'Conectando…',
  talking: 'Em conversa',
};

let timerInterval: number | undefined;

function action(a: CallAction, digit?: string): void {
  chrome.runtime.sendMessage({ target: 'background', type: 'CALL_ACTION', action: a, digit });
}

function formatElapsed(startMs: number): string {
  const total = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function stopTimer(): void {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = undefined; }
}

function renderCall(state: CallState): void {
  // Chamada terminou: fecha a janela.
  if (!state.active) {
    stopTimer();
    window.close();
    return;
  }

  const incoming = state.direction === 'inbound'
    && (state.callStatus === 'ringing' || state.isRing);

  incomingView.hidden = !incoming;
  incallView.hidden = incoming;

  if (incoming) {
    incNumber.textContent = state.name || state.number || 'Desconhecido';
    return;
  }

  icNumber.textContent = state.name || state.number || '';
  icStatus.textContent = CALL_LABEL[state.callStatus ?? ''] ?? '';

  muteBtn.textContent = state.isMute ? 'Ativar som' : 'Mudo';
  muteBtn.classList.toggle('active', !!state.isMute);
  holdBtn.textContent = state.isHold ? 'Retomar' : 'Espera';
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

// Controles
$<HTMLButtonElement>('answer-btn').addEventListener('click', () => action('answer'));
$<HTMLButtonElement>('reject-btn').addEventListener('click', () => action('reject'));
$<HTMLButtonElement>('hangup-btn').addEventListener('click', () => action('hangup'));
muteBtn.addEventListener('click', () => action(muteBtn.classList.contains('active') ? 'unmute' : 'mute'));
holdBtn.addEventListener('click', () => action(holdBtn.classList.contains('active') ? 'unhold' : 'hold'));
dtmfBtn.addEventListener('click', () => { dtmfPad.hidden = !dtmfPad.hidden; });

for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']) {
  const b = document.createElement('button');
  b.textContent = d;
  b.addEventListener('click', () => action('dtmf', d));
  dtmfPad.appendChild(b);
}

chrome.runtime.onMessage.addListener((raw: AnyMessage) => {
  if (raw.target !== 'popup') return;
  if (raw.type === 'CALL_STATE') renderCall(raw.state);
});

// Ao abrir, pega o estado atual; se não houver chamada, fecha.
(async () => {
  const snap = (await chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATUS' })) as
    | StatusSnapshot
    | undefined;
  renderCall(snap?.callState ?? { active: false });
})();
