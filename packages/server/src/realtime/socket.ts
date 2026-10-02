import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type {
  Chat,
  ChatEvent,
  ClientToServerEvents,
  Message,
  MessageStatusPayload,
  Note,
  ServerToClientEvents,
  TunnelStatus,
  User,
  WaStatus,
} from '@wa-team-inbox/shared';
import { SESSION_COOKIE } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { contextHostPolicy, hostAllowed } from '../http/host.js';

export interface SocketData {
  userId: number;
  displayName: string;
  role: User['role'];
  token: string;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

declare module '../context.js' {
  interface Services {
    /** set by attachRealtime() once the HTTP server is listening */
    realtime?: RealtimeService;
  }
}

export interface RealtimeService {
  io: IoServer;
  close(): void;
  isOnline(userId: number): boolean;
}

export const TYPING_THROTTLE_MS = 2000;

/** Extracts one cookie value from a Cookie header (URL-decoded, tolerant of bad encodings). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const raw = part.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Same rule as the HTTP origin hook: if an Origin header is present its host must equal Host. */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = (req.headers.host ?? '').toLowerCase();
  if (!host || origin === 'null') return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/**
 * Attaches Socket.IO to the HTTP server. Cookie-authenticated handshake; rooms `user:<id>`, `all`, `admins`.
 * Bridges domain bus events to clients and kicks sockets of disabled / revoked users.
 * Registers itself as ctx.services.realtime (used by push to skip online users).
 */
export function attachRealtime(server: HttpServer, ctx: AppContext): RealtimeService {
  const hostPolicy = contextHostPolicy(ctx);
  const io: IoServer = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    allowRequest: (req, cb) => cb(null, hostAllowed(req.headers.host, hostPolicy) && originAllowed(req)),
  });
  const online = new Map<number, number>();
  const lastTyping = new Map<string, number>();

  io.use((socket, next) => {
    const auth = ctx.services.auth;
    const token = readCookie(socket.request.headers.cookie, SESSION_COOKIE);
    const user = auth && token ? auth.resolveSession(token) : null;
    if (!user || !token || user.disabled || user.mustChangePassword) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data = { userId: user.id, displayName: user.displayName, role: user.role, token };
    next();
  });

  io.on('connection', (socket: IoSocket) => {
    const { userId } = socket.data;
    void socket.join([`user:${userId}`, 'all', ...(socket.data.role === 'admin' ? ['admins'] : [])]);
    online.set(userId, (online.get(userId) ?? 0) + 1);

    socket.on('typing', (p) => {
      const chatJid = p && typeof p === 'object' ? (p as { chatJid?: unknown }).chatJid : undefined;
      if (typeof chatJid !== 'string' || !chatJid || chatJid.length > 256) return;
      const key = `${userId}\u0000${chatJid}`;
      const now = Date.now();
      const last = lastTyping.get(key);
      if (last !== undefined && now - last < TYPING_THROTTLE_MS) return;
      lastTyping.set(key, now);
      if (lastTyping.size > 5000) {
        for (const [k, at] of lastTyping) if (now - at >= TYPING_THROTTLE_MS) lastTyping.delete(k);
      }
      socket.to('all').except(`user:${userId}`).emit('typing', { chatJid, userId, displayName: socket.data.displayName });
    });

    socket.on('disconnect', () => {
      const n = (online.get(userId) ?? 1) - 1;
      if (n <= 0) online.delete(userId);
      else online.set(userId, n);
    });
  });

  const kick = (s: { emit: IoSocket['emit']; disconnect(close?: boolean): unknown }) => {
    s.emit('session:revoked');
    s.disconnect(true);
  };

  // bus → clients
  const onMessageNew = (m: Message) => io.to('all').emit('message:new', m);
  const onMessageStatus = (p: MessageStatusPayload) => io.to('all').emit('message:status', p);
  const onChatUpdated = (c: Chat) => io.to('all').emit('chat:updated', c);
  const onChatEvent = (e: ChatEvent) => io.to('all').emit('chat:event', e);
  const onNote = (n: Note) => io.to('all').emit('note:new', n);
  const onWaStatus = (s: WaStatus) => {
    io.to('admins').emit('wa:status', s);
    io.to('all').except('admins').emit('wa:status', { ...s, qr: null });
  };
  const onTunnel = (s: TunnelStatus) => io.to('admins').emit('tunnel:status', s);
  const onDisabled = (userId: number) => {
    for (const s of io.of('/').sockets.values()) if (s.data.userId === userId) kick(s);
  };
  // All sessions revoked: kick every socket whose session no longer resolves.
  const onRevoked = (userId: number) => {
    const auth = ctx.services.auth;
    for (const s of io.of('/').sockets.values()) {
      if (s.data.userId !== userId) continue;
      const u = auth ? auth.resolveSession(s.data.token) : null;
      if (!u || u.disabled || u.mustChangePassword) kick(s);
    }
  };

  // Role changed: move live sockets in/out of 'admins' (QR + tunnel status are admin-only).
  const onRoleChanged = (userId: number, role: User['role']) => {
    for (const s of io.of('/').sockets.values()) {
      if (s.data.userId !== userId) continue;
      s.data.role = role;
      if (role === 'admin') void s.join('admins');
      else void s.leave('admins');
    }
  };

  const { bus } = ctx;
  bus.on('message:new', onMessageNew);
  bus.on('message:status', onMessageStatus);
  bus.on('chat:updated', onChatUpdated);
  bus.on('chat:event', onChatEvent);
  bus.on('note:new', onNote);
  bus.on('wa:status', onWaStatus);
  bus.on('tunnel:status', onTunnel);
  bus.on('user:disabled', onDisabled);
  bus.on('user:sessions-revoked', onRevoked);
  bus.on('user:role-changed', onRoleChanged);

  let closed = false;
  const service: RealtimeService = {
    io,
    isOnline: (userId) => (online.get(userId) ?? 0) > 0,
    close() {
      if (closed) return;
      closed = true;
      bus.off('message:new', onMessageNew);
      bus.off('message:status', onMessageStatus);
      bus.off('chat:updated', onChatUpdated);
      bus.off('chat:event', onChatEvent);
      bus.off('note:new', onNote);
      bus.off('wa:status', onWaStatus);
      bus.off('tunnel:status', onTunnel);
      bus.off('user:disabled', onDisabled);
      bus.off('user:sessions-revoked', onRevoked);
      bus.off('user:role-changed', onRoleChanged);
      io.disconnectSockets(true);
      // Close engine.io clients without closing the HTTP server (Fastify owns that).
      io.engine?.close();
      online.clear();
      lastTyping.clear();
      if (ctx.services.realtime === service) delete ctx.services.realtime;
    },
  };
  ctx.services.realtime = service;
  return service;
}
