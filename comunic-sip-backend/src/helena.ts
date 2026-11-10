// Validação da identidade do usuário via API do Comunic Chat (Helena).
// Usamos o token da sessão do Comunic Chat só para identificar o usuário
// (endpoint agent/me) e o descartamos — nunca é armazenado.
import { config } from './config.js';

export interface HelenaIdentity {
  userId: string;
  companyId: string;
  name?: string;
  profile?: string;
  departments?: unknown[];
}

export async function validateHelenaToken(bearer: string): Promise<HelenaIdentity | null> {
  // OBS: agent/me é API interna da Helena; confirmar os nomes dos campos no ambiente real.
  const res = await fetch(`${config.helenaBase}/core/v1/agent/me?includeDetails=1`, {
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  const j: any = await res.json().catch(() => null);
  if (!j) return null;
  const userId = j.userId ?? j.id;
  const companyId = j.tenantId ?? j.companyId ?? j.defaultTenantId;
  if (!userId) return null;
  return { userId, companyId, name: j.name, profile: j.profile, departments: j.departments };
}
