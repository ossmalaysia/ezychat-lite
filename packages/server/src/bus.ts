import { EventEmitter } from 'node:events';
import type {
  Chat,
  Role,
  ChatEvent,
  Message,
  Note,
  ServerToClientEvents,
  TunnelStatus,
  WaStatus,
} from '@wa-team-inbox/shared';

export interface BusEvents {
  'message:new': [Message];
  'message:status': [Parameters<ServerToClientEvents['message:status']>[0]];
  'chat:updated': [Chat];
  'chat:event': [ChatEvent];
  'note:new': [Note];
  'wa:status': [WaStatus];
  'tunnel:status': [TunnelStatus];
  'user:disabled': [number];
  'user:sessions-revoked': [number];
  /** userId, new role (live sockets must join/leave the 'admins' room) */
  'user:role-changed': [number, Role];
  /** for push routing */
  'inbound:notify': [{ chat: Chat; message: Message }];
  /** Live WhatsApp receipt, before media downloads; automation must react to arrival order. */
  'message:received': [{ chat: Chat; message: Message }];
}

type Listener<K extends keyof BusEvents> = (...args: BusEvents[K]) => void;

/** In-process typed domain event bus. Listener errors are isolated (logged via 'error' handler if set). */
export class Bus {
  private readonly ee = new EventEmitter();

  constructor(private readonly onListenerError?: (err: unknown, event: string) => void) {
    this.ee.setMaxListeners(100);
  }

  on<K extends keyof BusEvents>(ev: K, fn: Listener<K>): this {
    this.ee.on(ev, fn as (...a: unknown[]) => void);
    return this;
  }

  once<K extends keyof BusEvents>(ev: K, fn: Listener<K>): this {
    this.ee.once(ev, fn as (...a: unknown[]) => void);
    return this;
  }

  off<K extends keyof BusEvents>(ev: K, fn: Listener<K>): this {
    this.ee.off(ev, fn as (...a: unknown[]) => void);
    return this;
  }

  emit<K extends keyof BusEvents>(ev: K, ...args: BusEvents[K]): boolean {
    const listeners = this.ee.listeners(ev);
    for (const l of listeners) {
      try {
        (l as (...a: unknown[]) => void)(...args);
      } catch (err) {
        if (this.onListenerError) this.onListenerError(err, ev);
        else throw err;
      }
    }
    return listeners.length > 0;
  }

  removeAllListeners(): void {
    this.ee.removeAllListeners();
  }
}
