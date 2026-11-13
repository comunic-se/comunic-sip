// Ajustes de áudio do usuário (Ajustes → Áudio). Ficam em chrome.storage.local.
// IDs vazios = dispositivo padrão do sistema.
export interface AudioSettings {
  /** Microfone usado nas chamadas (vale a partir da próxima chamada). */
  micId: string;
  /** Saída da voz da chamada (fone/alto-falante). Troca na hora, inclusive em chamada. */
  speakerId: string;
  /** Saída do toque de chamada recebida (ex.: caixa de som enquanto usa fone). */
  ringId: string;
  /** Volume do toque, 0–100. */
  ringVolume: number;
  /** Tocar o toque de chamada recebida. */
  ringEnabled: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = {
  micId: '',
  speakerId: '',
  ringId: '',
  ringVolume: 60,
  ringEnabled: true,
};
