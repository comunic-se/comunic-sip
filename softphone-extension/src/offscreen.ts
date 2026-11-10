// Offscreen document: aqui roda o ys-webrtc-sdk-core (registro do ramal,
// áudio e eventos de chamada). O service worker fala com este arquivo por mensagens.
//
// OBS: a assinatura exata do pacote 1.1.0 (nome do export `init`, formato dos
// eventos) está descrita em docs/notas-tecnicas e deve ser confirmada contra o
// demo oficial. O fluxo abaixo segue essas notas.
import { init } from 'ys-webrtc-sdk-core';
import type { AnyMessage, CallAction, CallState, HistoryItem, RegStatus, SdkConfig } from './shared/messages';

// Operador devolvido pelo SDK: { phone, pbx, destroy }
let operator: any = null;
let currentSession: any = null;
// Estado da transferência assistida (consulta): cliente em espera + perna de consulta.
let transferState:
  | { customer: any; customerCallId: string; target: string; consultSession: any; consultCallId: string | null }
  | null = null;

function sendStatus(status: RegStatus, detail?: string): void {
  chrome.runtime
    .sendMessage({ target: 'background', type: 'STATUS', status, detail })
    .catch(() => { /* sem receptor */ });
}

function sendCallEvent(event: string, call?: Record<string, unknown>): void {
  chrome.runtime
    .sendMessage({ target: 'background', type: 'CALL_EVENT', event, call })
    .catch(() => { /* sem receptor */ });
}

/** Converte session.status (CallStatus do SDK) no nosso CallState. */
function snapshotState(session: any, active: boolean): CallState {
  const s = session?.status ?? {};
  return {
    active,
    callId: s.callId,
    number: s.number,
    name: s.name,
    direction: s.communicationType,
    callStatus: s.callStatus,
    isRing: s.isRing,
    isMute: s.isMute,
    isHold: s.isHold,
    callStartTime: s.callStartTime,
    transferring: !!transferState,
    transferTarget: transferState?.target,
  };
}

function sendCallState(session: any, active: boolean): void {
  chrome.runtime
    .sendMessage({ target: 'background', type: 'CALL_STATE', state: snapshotState(session, active) })
    .catch(() => { /* sem receptor */ });
}

function sendNoCall(): void {
  chrome.runtime
    .sendMessage({ target: 'background', type: 'CALL_STATE', state: { active: false } })
    .catch(() => { /* sem receptor */ });
}

function attachRemoteAudio(stream: MediaStream): void {
  let el = document.getElementById('remote-audio') as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement('audio');
    el.id = 'remote-audio';
    el.autoplay = true;
    document.body.appendChild(el);
  }
  el.srcObject = stream;
  el.muted = false;
  el.volume = 1;
  // Força a reprodução: em documento offscreen o autoplay às vezes não dispara sozinho.
  el.play().then(
    () => console.log('[Comunic.SIP] áudio remoto tocando', stream.getAudioTracks()),
    (e) => console.error('[Comunic.SIP] falha ao tocar áudio remoto:', e),
  );
}

// Observa o estado da sessão (calling → ringing → connecting → talking) e
// repassa pro popup. É daqui que sai o "tocou / ocupado / falhou".
function wireSession(session: any): void {
  if (!session?.on) return;

  // O áudio remoto vem do getter session.remoteStream. Ele fica disponível
  // quando a faixa remota é adicionada — por isso tocamos em vários gatilhos.
  const playRemote = () => {
    const rs = session.remoteStream as MediaStream | undefined;
    if (rs?.getAudioTracks) {
      console.log('[Comunic.SIP] anexando remoteStream', rs.getAudioTracks());
      attachRemoteAudio(rs);
    }
  };

  session.on('statusChange', (now: any, prev: any) => {
    const callStatus = now?.callStatus ?? String(now);
    console.log('[Comunic.SIP] statusChange', callStatus, '(antes:', prev?.callStatus ?? prev, ')');
    sendCallState(session, true);
    if (callStatus === 'talking') playRemote();
  });
  // staticStatusChange também muda mudo/espera/nome — reflete no popup.
  session.on('staticStatusChange', () => sendCallState(session, true));

  // Eventos da Session (não do phone!) que entregam o áudio remoto.
  session.on('streamAdded', () => { console.log('[Comunic.SIP] session streamAdded'); playRemote(); });
  session.on('updateRemoteStream', () => { console.log('[Comunic.SIP] session updateRemoteStream'); playRemote(); });
  session.on('accepted', () => { console.log('[Comunic.SIP] session accepted'); playRemote(); });
  session.on('confirmed', () => { console.log('[Comunic.SIP] session confirmed'); playRemote(); });
}

async function initSdk(config: SdkConfig): Promise<void> {
  if (!config.pbxURL.startsWith('https://')) {
    sendStatus('failed', 'A URL do PBX precisa ser HTTPS.');
    return;
  }

  // Encerra uma sessão anterior, se houver.
  if (operator) {
    try { operator.destroy?.(); } catch { /* ignore */ }
    operator = null;
    currentSession = null;
  }

  sendStatus('connecting');

  try {
    operator = await init({
      username: config.extension,
      secret: config.signature,
      pbxURL: config.pbxURL,
    });

    console.log('[Comunic.SIP] init resolvido. operator keys:', Object.keys(operator ?? {}));

    // Exposto só pra depuração no console do offscreen: __comunic.phone, .pbx
    (globalThis as any).__comunic = operator;

    const { phone } = operator;
    console.log('[Comunic.SIP] phone props:', phone && Object.keys(phone));
    console.log('[Comunic.SIP] phone.isRegistered (inicial):', phone?.isRegistered);

    phone.on('isRegisteredChange', (registered: boolean) => {
      console.log('[Comunic.SIP] isRegisteredChange =>', registered);
      sendStatus(registered ? 'registered' : 'connecting');
    });
    phone.on('registrationFailed', (cause: unknown) => {
      console.log('[Comunic.SIP] registrationFailed =>', cause);
      sendStatus('failed', 'Registro SIP falhou: ' + String(cause));
    });
    phone.on('incoming', ({ callId, session }: any) => {
      console.log('[Comunic.SIP] evento incoming', callId);
      currentSession = session;
      wireSession(session);
      sendCallState(session, true);
    });
    phone.on('newRTCSession', ({ callId, session }: any) => {
      console.log('[Comunic.SIP] evento newRTCSession', callId, 'status:', session?.status);
      currentSession = session;
      wireSession(session);
    });
    phone.on('startSession', ({ callId, session }: any) => {
      console.log('[Comunic.SIP] evento startSession', callId, 'status:', session?.status);
      currentSession = session;
      wireSession(session);
      // Se estamos consultando, esta perna com isTransfer é a consulta.
      if (transferState && session?.status?.isTransfer) {
        transferState.consultSession = session;
        transferState.consultCallId = session?.status?.callId ?? callId ?? null;
        console.log('[Comunic.SIP] perna de consulta:', transferState.consultCallId);
      }
      sendCallState(session, true);
    });
    phone.on('deleteSession', ({ callId, cause }: any) => {
      console.log('[Comunic.SIP] evento deleteSession', callId, 'causa:', cause);
      currentSession = null;
      if (transferState) {
        const ts = transferState;
        if (callId && ts.consultCallId && callId === ts.consultCallId) {
          // A consulta terminou (destino desligou ou cancelamos): volta ao cliente.
          transferState = null;
          ts.customer?.unhold?.();
          currentSession = ts.customer;
          if (ts.customer) { sendCallState(ts.customer, true); return; }
        } else if (callId && callId === ts.customerCallId) {
          // O cliente saiu durante a consulta.
          transferState = null;
        }
      }
      if (!currentSession && !transferState) sendNoCall();
    });
    // Obs: 'streamAdded' é evento da Session, tratado em wireSession() — não do phone.

    // ESSENCIAL: o SDK não registra sozinho no init. Só depois de assinar os
    // eventos é que se inicia o registro do SIP UA com phone.start().
    console.log('[Comunic.SIP] chamando phone.start() para registrar o SIP UA…');
    await phone.start();

    // NÃO reportamos "registered" otimista: o status só vira "Disponível"
    // quando o registro SIP real acontecer (isRegisteredChange => true).
    if (phone?.isRegistered) {
      sendStatus('registered');
    } else {
      sendStatus('connecting', 'Aguardando registro SIP…');
    }
  } catch (err: any) {
    sendStatus('failed', err?.message ?? String(err));
  }
}

function resolvePhone(): any {
  // Dependendo do build do SDK, init devolve { phone, pbx } ou o próprio phone.
  return operator?.phone ?? operator;
}

async function ensureMic(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Só confirmamos a permissão; o SDK abre o seu próprio stream na chamada.
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    // No offscreen não dá pra exibir o prompt: pedimos ao background abrir a janela.
    chrome.runtime.sendMessage({ target: 'background', type: 'REQUEST_MIC' }).catch(() => { /* */ });
    sendCallEvent('error', { state: 'Permita o microfone na janela que abriu e ligue de novo.' });
    return false;
  }
}

async function doCall(number: string): Promise<void> {
  if (!operator) {
    sendStatus('failed', 'SDK não iniciado. Conecte o ramal primeiro.');
    return;
  }
  const phone = resolvePhone();
  const keys = Object.keys(operator ?? {});
  console.log('[Comunic.SIP] doCall', number, '| operator keys:', keys, '| phone.call?', typeof phone?.call);

  if (typeof phone?.call !== 'function') {
    sendCallEvent('error', { state: `phone.call ausente — operator keys: ${keys.join(', ')}` });
    return;
  }
  if (!(await ensureMic())) return;

  try {
    const maybeSession = await phone.call(number);
    console.log('[Comunic.SIP] phone.call retornou:', maybeSession);
    if (maybeSession?.on) {
      currentSession = maybeSession;
      wireSession(maybeSession);
    }
    sendCallEvent('dialing', { number, direction: 'outbound' });
  } catch (e: any) {
    console.error('[Comunic.SIP] erro no phone.call', e);
    sendCallEvent('error', { state: String(e?.message ?? e) });
  }
}

async function doAction(action: CallAction, digit?: string, arg?: string): Promise<void> {
  const s = currentSession;
  if (!s) {
    console.warn('[Comunic.SIP] ação sem sessão ativa:', action);
    return;
  }
  console.log('[Comunic.SIP] ação na chamada:', action, digit ?? arg ?? '');
  switch (action) {
    case 'answer':
      if (!(await ensureMic())) return;
      await s.answer?.();
      break;
    case 'reject': s.reject?.(); break;
    case 'hangup': s.hangup?.(); break;
    case 'mute': s.mute?.(); sendCallState(s, true); break;
    case 'unmute': s.unmute?.(); sendCallState(s, true); break;
    case 'hold': s.hold?.(); sendCallState(s, true); break;
    case 'unhold': s.unhold?.(); sendCallState(s, true); break;
    case 'dtmf': if (digit) s.dtmf?.(digit); break;
    case 'blindTransfer': if (arg) s.blindTransfer?.(arg); break;
  }
}

// --- Transferência assistida (consulta) ---
async function startConsult(target: string): Promise<void> {
  const customer = currentSession;
  const customerCallId = customer?.status?.callId;
  if (!customer || !customerCallId || !target) {
    console.warn('[Comunic.SIP] consulta sem chamada ativa');
    return;
  }
  transferState = { customer, customerCallId, target, consultSession: null, consultCallId: null };
  try {
    // phone.call(destino, {}, callIdDoCliente) cria a perna de consulta e segura o cliente.
    await operator.phone.call(target, {}, customerCallId);
  } catch (e) {
    console.error('[Comunic.SIP] consulta falhou', e);
    transferState = null;
    customer.unhold?.();
    currentSession = customer;
    sendCallState(customer, true);
  }
}

function completeTransfer(): void {
  const ts = transferState;
  if (!ts?.consultCallId) {
    console.warn('[Comunic.SIP] não há consulta para concluir');
    return;
  }
  transferState = null; // evita o deleteSession tentar retomar o cliente
  operator.phone.attendedTransfer(ts.consultCallId, ts.target);
}

function cancelConsult(): void {
  // Desliga a consulta; o deleteSession retoma o cliente da espera.
  const ts = transferState;
  (ts?.consultSession ?? currentSession)?.hangup?.();
}

async function getHistory(): Promise<HistoryItem[]> {
  const pbx = operator?.pbx;
  if (!pbx?.cdrQuery) return [];
  try {
    const res = await pbx.cdrQuery({ page: 1, size: 50, status: 0, sortBy: 'time', orderBy: 'desc' });
    const list: any[] = res?.personal_cdr_list ?? res?.data?.personal_cdr_list ?? [];
    return list.map((it: any) => ({
      number: it.number ?? it.extension?.ext_num ?? '',
      name: it.extension?.caller_id_name || it.name || undefined,
      timestamp: Number(it.timestamp ?? it.time ?? 0),
      direction: it.status === 2 ? 'missed' : it.status === 1 ? 'inbound' : 'outbound',
      disposition: it.disposition,
      talkDuration: Number(it.talk_duration ?? 0),
    }));
  } catch (e) {
    console.error('[Comunic.SIP] cdrQuery falhou', e);
    return [];
  }
}

chrome.runtime.onMessage.addListener((raw: AnyMessage, _sender, sendResponse) => {
  if (raw.target !== 'offscreen') return;
  if (raw.type === 'GET_HISTORY') {
    getHistory().then(sendResponse);
    return true; // resposta assíncrona
  }
  switch (raw.type) {
    case 'INIT': initSdk(raw.config); break;
    case 'CALL': doCall(raw.number); break;
    case 'CALL_ACTION':
      if (raw.action === 'consult') startConsult(raw.arg ?? '');
      else if (raw.action === 'completeTransfer') completeTransfer();
      else if (raw.action === 'cancelTransfer') cancelConsult();
      else doAction(raw.action, raw.digit, raw.arg);
      break;
  }
  return undefined;
});
