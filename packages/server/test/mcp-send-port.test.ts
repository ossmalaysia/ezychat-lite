// InboxSendPort directly (real app, fake WhatsApp, controllable clock): limits per day, the queued flag while
// WhatsApp is offline, and the scope check of the port itself (defence in depth behind the tool list).
import { afterEach, describe, expect, it } from 'vitest';
import type { User } from '@ezychat/shared';
import type { ApiPrincipal } from '../src/api-tokens/index.js';
import { createInboxSendPort, SEND_LIMITS, SendError } from '../src/mcp/send.js';
import { makeTestApp, type TestApp } from './helpers.js';

const CHAT = '60123456789@s.whatsapp.net';
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup() {
  t = await makeTestApp();
  const admin: User = t.ctx.services.auth!.createUser({
    username: 'owner',
    displayName: 'Owner',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  t.wa.simulateIncoming({ chatJid: CHAT, body: 'Hello?', senderName: 'Aminah' });
  const start = Date.now();
  while ((t.ctx.db.prepare('SELECT COUNT(*) AS n FROM chats').get() as { n: number }).n === 0) {
    if (Date.now() - start > 3000) throw new Error('chat not created');
    await new Promise((r) => setTimeout(r, 10));
  }
  const principal = (scopes: string[]): ApiPrincipal => ({
    tokenId: 7,
    user: admin,
    scopes: new Set(scopes) as ApiPrincipal['scopes'],
  });
  return { app: t, principal };
}

describe('InboxSendPort', () => {
  it('refuses a principal without inbox:send even when called directly', async () => {
    const { app, principal } = await setup();
    const port = createInboxSendPort(app.ctx);
    expect(() =>
      port.sendText(principal(['inbox:read', 'ai:setup']), {
        jid: CHAT,
        text: 'hi',
        requestId: 'req-00000001',
      }),
    ).toThrow(SendError);
  });

  it('reports queued while WhatsApp is offline; the queue keeps the message pending', async () => {
    const { app, principal } = await setup();
    app.wa.setConnected(false);
    const port = createInboxSendPort(app.ctx);
    const r = port.sendText(principal(['inbox:send']), {
      jid: CHAT,
      text: 'We will call you back.',
      requestId: 'req-offline-1',
    });
    expect(r).toMatchObject({ queued: true, status: 'pending', duplicate: false });
    expect(app.wa.sent).toHaveLength(0);
  });

  it('allows 100 messages a day per token, then refuses until the day window passes', async () => {
    const { app, principal } = await setup();
    let now = Date.parse('2026-10-20T08:00:00Z');
    const port = createInboxSendPort(app.ctx, { now: () => now });
    const p = principal(['inbox:send']);
    const send = (i: number) =>
      port.sendText(p, { jid: CHAT, text: `daily ${i}`, requestId: `req-daily-${i}-x` });
    for (let i = 0; i < SEND_LIMITS.perDay.max; i++) {
      if (i > 0 && i % SEND_LIMITS.perMinute.max === 0) now += SEND_LIMITS.perMinute.windowMs;
      send(i);
    }
    now += SEND_LIMITS.perMinute.windowMs;
    expect(() => send(999)).toThrow(/a day; try again in \d+ s/);
    now += SEND_LIMITS.perDay.windowMs;
    expect(send(1000).duplicate).toBe(false);
  });

  it('turns expected message-service refusals into a message for the model', async () => {
    const { app, principal } = await setup();
    const port = createInboxSendPort(app.ctx);
    expect(() =>
      port.sendText(principal(['inbox:send']), {
        jid: CHAT,
        text: 'quote',
        requestId: 'req-quote-1',
        quotedMessageId: 'missing',
      }),
    ).toThrow(SendError);
  });
});
