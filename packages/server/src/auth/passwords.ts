import { hash, hashSync, verify } from '@node-rs/argon2';
import { randomInt } from 'node:crypto';

// @node-rs/argon2 defaults to argon2id (m=19456 KiB, t=2, p=1), matching OWASP guidance.

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function hashPasswordSync(password: string): string {
  return hashSync(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A valid argon2id hash of a random string; used to equalize timing for unknown usernames.
let dummyHash: string | null = null;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= hashSync(`dummy-${randomInt(1e9)}`);
  await verifyPassword(dummyHash, password);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Random human-friendly password (no ambiguous characters). */
export function generatePassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
