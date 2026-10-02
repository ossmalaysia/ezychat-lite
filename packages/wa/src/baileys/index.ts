import type { WaAdapter, WaAdapterOptions } from '../types.js';
import { BaileysAdapter } from './adapter.js';

export function createBaileysAdapter(opts: WaAdapterOptions): WaAdapter {
  return new BaileysAdapter(opts);
}

export { BaileysAdapter } from './adapter.js';
export { classifyDisconnect, backoffMs, type DisconnectAction } from './disconnect.js';
export { mapWAMessage, jidType } from './mapping.js';
export { createAuthStore, type AuthStore } from './auth-store.js';
