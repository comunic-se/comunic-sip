// Popup: ajustes do ramal, status de registro e discador básico.
import type { AnyMessage, RegStatus, SdkConfig, StatusSnapshot } from '../shared/messages';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const pill = $('status-pill');
const statusText = $('status-text');
const callInfo = $('call-info');
const dialInput = $<HTMLInputElement>('dial-input');
const callBtn = $<HTMLButtonElement>('call-btn');
const hangupBtn = $<HTMLButtonElement>('hangup-btn');

const STATUS_LABEL: Record<RegStatus, string> = {
  idle: 'Desconectado',
  connecting: 'Conectando…',
  registered: 'Disponível',
  failed: 'Falha',
};

function renderStatus(status: RegStatus, detail?: string): void {
  pill.className = `pill pill--${status}`;
  statusText.textContent = STATUS_LABEL[status];
  const inCall = status === 'registered';
  callBtn.disabled = status !== 'registered';
  hangupBtn.disabled = !inCall;
  callInfo.textContent = detail ?? '';
}

// --- Ajustes persistidos ---
async function loadSettings(): Promise<void> {
  const s = await chrome.storage.local.get(['pbxURL', 'extension', 'signature']);
  $<HTMLInputElement>('pbx-url').value = s.pbxURL ?? '';
  $<HTMLInputElement>('extension').value = s.extension ?? '';
  $<HTMLTextAreaElement>('signature').value = s.signature ?? '';
}

function readConfig(): SdkConfig {
  return {
    pbxURL: $<HTMLInputElement>('pbx-url').value.trim(),
    extension: $<HTMLInputElement>('extension').value.trim(),
    signature: $<HTMLTextAreaElement>('signature').value.trim(),
  };
}

$<HTMLButtonElement>('connect-btn').addEventListener('click', async () => {
  const config = readConfig();
  if (!config.pbxURL || !config.extension || !config.signature) {
    renderStatus('failed', 'Preencha URL, ramal e assinatura.');
    return;
  }
  // O offscreen precisa de permissão de host pro domínio do PBX (CORS).
  // chrome.permissions.request exige gesto do usuário — por isso é aqui no clique.
  let origin: string;
  try {
    origin = new URL(config.pbxURL).origin + '/*';
  } catch {
    renderStatus('failed', 'URL do PBX inválida.');
    return;
  }
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    renderStatus('failed', 'Permissão de acesso ao PBX negada.');
    return;
  }

  await chrome.storage.local.set(config);
  renderStatus('connecting');
  chrome.runtime.sendMessage({ target: 'background', type: 'INIT_SDK', config });
});

// --- Discador ---
callBtn.addEventListener('click', () => {
  const number = dialInput.value.trim();
  if (!number) return;
  chrome.runtime.sendMessage({ target: 'background', type: 'CALL', number });
});

hangupBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ target: 'background', type: 'HANGUP' });
});

// --- Eventos vindos do background ---
chrome.runtime.onMessage.addListener((raw: AnyMessage) => {
  if (raw.target !== 'popup') return;
  if (raw.type === 'STATUS') {
    renderStatus(raw.status, raw.detail);
  } else if (raw.type === 'CALL_EVENT') {
    const n = raw.call?.number ? ` ${raw.call.number}` : '';
    callInfo.textContent = `${raw.event}${n}`;
    hangupBtn.disabled = raw.event === 'deleteSession';
  }
});

// --- Inicialização ---
(async () => {
  await loadSettings();
  const snap = (await chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATUS' })) as
    | StatusSnapshot
    | undefined;
  renderStatus(snap?.status ?? 'idle', snap?.detail);
})();
