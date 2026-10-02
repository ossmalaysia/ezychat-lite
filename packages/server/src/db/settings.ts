import type { DB } from './index.js';
import type { SecretBox } from '../crypto/secret.js';

/** Key/value settings persisted as JSON in the `settings` table; secrets are AES-GCM encrypted. */
export class SettingsStore {
  constructor(
    private readonly db: DB,
    private readonly secret: SecretBox,
  ) {}

  private raw(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private write(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    else
      this.db
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, value);
  }

  get<T>(key: string, fallback: T): T {
    const v = this.raw(key);
    if (v === undefined) return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.write(key, value === undefined ? null : JSON.stringify(value));
  }

  getSecret(key: string): string | null {
    const v = this.raw(key);
    if (v === undefined) return null;
    try {
      return this.secret.decrypt(v);
    } catch {
      return null;
    }
  }

  setSecret(key: string, value: string | null): void {
    this.write(key, value === null ? null : this.secret.encrypt(value));
  }
}
