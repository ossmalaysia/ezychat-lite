import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const KEY_LEN = 32;
const IV_LEN = 12;

/** AES-256-GCM box for at-rest secrets. Blob format: base64(iv).base64(tag).base64(ciphertext). */
export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  static fromKey(key: Buffer): SecretBox {
    if (key.length !== KEY_LEN) throw new Error('secret key must be 32 bytes');
    return new SecretBox(key);
  }

  static loadOrCreate(keyFile: string): SecretBox {
    if (existsSync(keyFile)) {
      const key = readFileSync(keyFile);
      if (key.length !== KEY_LEN) throw new Error(`invalid secret key file: ${keyFile}`);
      return new SecretBox(key);
    }
    mkdirSync(dirname(keyFile), { recursive: true });
    const key = randomBytes(KEY_LEN);
    writeFileSync(keyFile, key, { mode: 0o600, flag: 'wx' });
    try {
      chmodSync(keyFile, 0o600);
    } catch {
      // best effort (Windows)
    }
    return new SecretBox(key);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
  }

  decrypt(blob: string): string {
    const parts = blob.split('.');
    if (parts.length !== 3) throw new Error('invalid secret blob');
    const [ivB, tagB, ctB] = parts as [string, string, string];
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  }
}

/** Random base64url token (default 32 bytes). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. */
export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
