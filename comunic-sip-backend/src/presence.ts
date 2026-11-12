// Presença da extensão: a extensão avisa o backend quando o registro do ramal
// muda e a cada ~60 s enquanto está registrada. Sem aviso por PRESENCE_TTL_MS,
// o ramal é considerado desconectado (navegador fechado, sem rede, etc.).
//
// Fica em memória: após reiniciar o backend, os status voltam em até 1 min.
// Se um dia houver mais de uma instância da API, mover para o banco/Redis.
export const PRESENCE_TTL_MS = 150_000; // 2,5 min (2 batidas perdidas)

export type PresenceStatus = 'online' | 'offline';
interface Entry { status: PresenceStatus; at: number; extension?: string }

const store = new Map<string, Entry>();
const k = (companyId: string, userId: string) => `${companyId}|${userId}`;

export function setPresence(companyId: string, userId: string, status: PresenceStatus, extension?: string): void {
  store.set(k(companyId, userId), { status, at: Date.now(), extension });
}

/** 'online' só se o último aviso foi "registrado" e é recente. */
export function getPresence(companyId: string, userId: string): { status: PresenceStatus; lastSeen: number | null } {
  const e = store.get(k(companyId, userId));
  if (!e) return { status: 'offline', lastSeen: null };
  const fresh = Date.now() - e.at < PRESENCE_TTL_MS;
  return { status: e.status === 'online' && fresh ? 'online' : 'offline', lastSeen: e.at };
}
