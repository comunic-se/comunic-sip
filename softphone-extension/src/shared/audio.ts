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
  /** Som do toque (arquivo em ringtones/<id>.mp3). */
  ringTone: RingTone;
}

// Toques de telefone (sintetizados para o Comunic.Chat; um ciclo cada, tocado em loop).
export type RingTone = 'campainha' | 'classico' | 'duplo' | 'americano' | 'digital' | 'suave';
export const RINGTONES: { id: RingTone; label: string }[] = [
  { id: 'campainha', label: 'Campainha de telefone' },
  { id: 'classico', label: 'Clássico (Brasil)' },
  { id: 'duplo', label: 'Toque duplo' },
  { id: 'americano', label: 'Americano' },
  { id: 'digital', label: 'Digital (PABX)' },
  { id: 'suave', label: 'Suave' },
];

export const DEFAULT_AUDIO: AudioSettings = {
  micId: '',
  speakerId: '',
  ringId: '',
  ringVolume: 60,
  ringEnabled: true,
  ringTone: 'campainha',
};
