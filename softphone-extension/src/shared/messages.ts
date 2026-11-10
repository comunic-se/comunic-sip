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

// popup -> background
export type ToBackground =
  | { target: 'background'; type: 'INIT_SDK'; config: SdkConfig }
  | { target: 'background'; type: 'GET_STATUS' }
  | { target: 'background'; type: 'CALL'; number: string }
  | { target: 'background'; type: 'HANGUP' }
  | { target: 'background'; type: 'REQUEST_MIC' }
  // offscreen -> background
  | { target: 'background'; type: 'STATUS'; status: RegStatus; detail?: string }
  | { target: 'background'; type: 'CALL_EVENT'; event: string; call?: CallInfo };

// background -> offscreen
export type ToOffscreen =
  | { target: 'offscreen'; type: 'INIT'; config: SdkConfig }
  | { target: 'offscreen'; type: 'CALL'; number: string }
  | { target: 'offscreen'; type: 'HANGUP' };

// background -> popup
export type ToPopup =
  | { target: 'popup'; type: 'STATUS'; status: RegStatus; detail?: string }
  | { target: 'popup'; type: 'CALL_EVENT'; event: string; call?: CallInfo };

export type AnyMessage = ToBackground | ToOffscreen | ToPopup;

export interface StatusSnapshot {
  status: RegStatus;
  detail?: string;
}
