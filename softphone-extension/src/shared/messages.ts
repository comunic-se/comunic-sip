// Tipos de mensagem trocadas entre popup, service worker (background) e offscreen.
// Cada mensagem carrega um `target` para que cada ouvinte processe só o que é dele.

export type RegStatus = 'idle' | 'connecting' | 'registered' | 'failed';

export interface SdkConfig {
  /** URL HTTPS do PBX, ex.: https://pbx.cliente.com.br (o SDK recusa HTTP). */
  pbxURL: string;
  /** Número do ramal. */
  extension: string;
  /** Assinatura (sign) gerada pelo backend/admin a partir do AccessID/AccessKey. */
  signature: string;
}

export interface CallInfo {
  callId?: string;
  number?: string;
  direction?: 'inbound' | 'outbound';
  state?: string;
}

/** Estado completo da chamada atual, derivado de session.status do SDK. */
export interface CallState {
  active: boolean;
  callId?: string;
  number?: string;
  name?: string;
  direction?: 'inbound' | 'outbound';
  callStatus?: 'ringing' | 'calling' | 'connecting' | 'talking';
  isRing?: boolean;
  isMute?: boolean;
  isHold?: boolean;
  callStartTime?: number;
  /** Em modo de transferência assistida (consultando o destino). */
  transferring?: boolean;
  transferTarget?: string;
}

export type CallAction =
  | 'answer'
  | 'reject'
  | 'hangup'
  | 'mute'
  | 'unmute'
  | 'hold'
  | 'unhold'
  | 'dtmf'
  | 'blindTransfer'
  | 'consult'
  | 'completeTransfer'
  | 'cancelTransfer';

/** Item do histórico de chamadas (CDR pessoal do ramal). */
export interface HistoryItem {
  number: string;
  name?: string;
  timestamp: number;
  direction: 'inbound' | 'outbound' | 'missed';
  disposition?: string;
  talkDuration?: number;
}

export interface Contact {
  id?: string;
  name: string;
  phoneNumber?: string;
  phoneNumberFormatted?: string;
  email?: string;
  annotation?: string;
}

// popup -> background
export type ToBackground =
  | { target: 'background'; type: 'INIT_SDK'; config: SdkConfig }
  | { target: 'background'; type: 'GET_STATUS' }
  | { target: 'background'; type: 'CALL'; number: string }
  | { target: 'background'; type: 'CALL_ACTION'; action: CallAction; digit?: string; arg?: string }
  | { target: 'background'; type: 'REQUEST_MIC' }
  | { target: 'background'; type: 'CONTACTS_SEARCH'; query: string }
  // Diretório de ramais da empresa (transferência)
  | { target: 'background'; type: 'DIRECTORY' }
  | { target: 'background'; type: 'CONTACT_SAVE'; contact: Contact }
  // offscreen -> background
  | { target: 'background'; type: 'STATUS'; status: RegStatus; detail?: string }
  | { target: 'background'; type: 'CALL_EVENT'; event: string; call?: CallInfo }
  | { target: 'background'; type: 'CALL_STATE'; state: CallState };

// background -> offscreen
export type ToOffscreen =
  | { target: 'offscreen'; type: 'INIT'; config: SdkConfig }
  // Assinatura renovada: reinicia o SDK agora, ou ao fim da chamada em andamento.
  | { target: 'offscreen'; type: 'RENEW'; config: SdkConfig }
  | { target: 'offscreen'; type: 'CALL'; number: string }
  | { target: 'offscreen'; type: 'CALL_ACTION'; action: CallAction; digit?: string; arg?: string }
  | { target: 'offscreen'; type: 'GET_HISTORY' }
  // Status atual do registro (presença no painel)
  | { target: 'offscreen'; type: 'GET_REG' };

// background -> popup
export type ToPopup =
  | { target: 'popup'; type: 'STATUS'; status: RegStatus; detail?: string }
  | { target: 'popup'; type: 'CALL_EVENT'; event: string; call?: CallInfo }
  | { target: 'popup'; type: 'CALL_STATE'; state: CallState };

export type AnyMessage = ToBackground | ToOffscreen | ToPopup;

export interface StatusSnapshot {
  status: RegStatus;
  detail?: string;
  callState?: CallState;
}
