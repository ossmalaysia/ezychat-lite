import type { WaAdapter } from '@ezychat/wa';
import type { Logger } from 'pino';
import type { AccessGate } from './access/gate.js';
import type { Bus } from './bus.js';
import type { ServerConfig } from './config.js';
import type { SecretBox } from './crypto/secret.js';
import type { DB } from './db/index.js';
import type { SettingsStore } from './db/settings.js';
import type { ServerExtension } from './extensions.js';

/**
 * Service registry. Later tasks attach their services via module augmentation, e.g.
 *   declare module '../context.js' { interface Services { auth: AuthService } }
 * A service exposing `shutdown(): Promise<void> | void` is called on server close.
 */
export interface Services {
  [k: string]: unknown;
}

export interface AppContext {
  config: ServerConfig;
  db: DB;
  bus: Bus;
  log: Logger;
  secret: SecretBox;
  settings: SettingsStore;
  wa: WaAdapter;
  services: Services;
  /** Product edition reported by /api/health ('lite' unless another build passes one). */
  edition: string;
  /** Extensions added by another product build; empty in Lite. */
  extensions: readonly ServerExtension[];
  /** Access gate: editions may close it (Lite never does); core services honour it. */
  access: AccessGate;
}
