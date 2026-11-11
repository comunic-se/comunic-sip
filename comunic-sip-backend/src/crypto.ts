// Criptografia dos segredos guardados no banco (AES-256-GCM).
// A chave vem de ENCRYPTION_KEY (32 bytes em base64). Nunca logar segredo.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(): Buffer {
  const b = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if (b.length !== 32) {
    throw new Error('ENCRYPTION_KEY precisa ter 32 bytes em base64 (gere com: openssl rand -base64 32)');
  }
  return b;
}

/** Cifra um texto. Formato de saída: iv.tag.ciphertext (cada parte em base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join('.');
}

/** Decifra um valor produzido por encryptSecret. */
export function decryptSecret(blob: string): string {
  const [ivB, tagB, encB] = blob.split('.');
  if (!ivB || !tagB || !encB) throw new Error('segredo cifrado em formato inválido');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}
