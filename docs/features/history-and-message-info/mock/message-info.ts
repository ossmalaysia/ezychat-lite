import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireUser } from '../../../../packages/server/src/auth/guards.js';
import { errors, parse } from '../../../../packages/server/src/http/errors.js';
import { parseChatKey } from '../../../../packages/server/src/inboxes/keys.js';
import type { FakeWaAdapter } from '@ezychat/wa';

/**
 * Proposed (history-and-message-info): a stand-in for the future `GET /api/messages/:id/info`.
 * The app stores no receipt times yet, so this mock makes them up from the message's own time and
 * status (fixed offsets, never random) and lets the dashed "Mock only" row pick a scenario.
 * A status that is known without a time comes back as `{ done: true, at: null }`: the dialog then
 * says "Yes, time not known". Nothing is stored; the scenario lives in memory.
 */

const Scenario = z.enum([
  'auto',
  'allTimes',
  'readNoTime',
  'sentOnly',
  'pending',
  'failed',
  'groupSeveral',
  'groupLongNames',
  'groupNoneYet',
]);
type Scenario = z.infer<typeof Scenario>;

interface Stamp {
  done: boolean;
  at: number | null;
}
interface MemberReceipt {
  name: string;
  delivered: Stamp;
  read: Stamp;
}

const MIN = 60_000;
const NO: Stamp = { done: false, at: null };
const at = (time: number): Stamp => ({ done: true, at: time });
const noTime: Stamp = { done: true, at: null };

const MEMBERS = ['Lim Mei Ling', 'Ahmad Faiz', 'Priya Nair', 'Tan Wei Jie', 'Siti Rahmah', 'Kumar'];
const LONG_MEMBERS = [
  'Nur Aisyah binti Mohd Khairul Anuar (Penang branch, weekend stock)',
  'Christopher Tan Boon Huat — Reseller, Bayan Lepas',
  'Muhammad Hafiz Iskandar Zulkarnain bin Abdullah',
  'Wong',
];

function members(base: number, names: string[], kind: 'mixed' | 'none'): MemberReceipt[] {
  return names.map((name, i) => {
    if (kind === 'none') return { name, delivered: NO, read: NO };
    // Members 0–2 read it (member 2 without a time: an older receipt from the history import),
    // member 3 has it delivered, the rest not yet.
    if (i < 2)
      return { name, delivered: at(base + (1 + i) * MIN), read: at(base + (6 + i * 9) * MIN) };
    if (i === 2) return { name, delivered: noTime, read: noTime };
    if (i === 3) return { name, delivered: at(base + 3 * MIN), read: NO };
    return { name, delivered: NO, read: NO };
  });
}

export function registerMessageInfo(
  app: FastifyInstance,
  ctx: AppContext,
  wa: FakeWaAdapter,
): void {
  let scenario: Scenario = 'auto';

  // The fake phone re-opens at once after Re-link; this puts it back on a QR code so the page
  // shows the "History import: …" line above the code (screenshots and hand checks).
  app.post('/api/mock/wa-qr', { preHandler: requireUser(ctx) }, async () => {
    wa.simulateStatus({ state: 'qr', me: null, qr: `mock-relink-${Date.now().toString(36)}` });
    return { state: wa.status.state };
  });

  app.get('/api/mock/message-info/scenario', { preHandler: requireUser(ctx) }, async () => ({
    scenario,
  }));
  app.put('/api/mock/message-info/scenario', { preHandler: requireUser(ctx) }, async (req) => {
    scenario = parse(z.object({ scenario: Scenario }), req.body ?? {}).scenario;
    return { scenario };
  });

  app.get<{ Params: { id: string } }>(
    '/api/mock/message-info/:id',
    { preHandler: requireUser(ctx) },
    async (req) => {
      const row = ctx.db
        .prepare('SELECT id, chat_jid, from_me, status, timestamp FROM messages WHERE id = ?')
        .get(req.params.id) as
        | { id: string; chat_jid: string; from_me: number; status: string; timestamp: number }
        | undefined;
      // Only the team's own messages have receipts (the app answers 404 for anything else).
      if (!row || !row.from_me) throw errors.notFound('Message');
      const group = parseChatKey(row.chat_jid).waJid.endsWith('@g.us');
      const base = row.timestamp;
      let pick: Scenario = scenario;
      if (pick === 'auto') {
        if (group)
          pick =
            row.status === 'pending' || row.status === 'failed'
              ? (row.status as Scenario)
              : 'groupSeveral';
        else
          pick =
            row.status === 'read'
              ? 'allTimes'
              : row.status === 'delivered' || row.status === 'sent'
                ? 'sentOnly'
                : (row.status as Scenario);
      }
      // A group scenario on a direct chat (or the other way round) falls back to the closest one.
      if (!group && pick.startsWith('group')) pick = 'allTimes';
      if (group && ['allTimes', 'readNoTime', 'sentOnly'].includes(pick)) pick = 'groupSeveral';

      const sent = at(base + 2_000);
      switch (pick) {
        case 'allTimes':
          return {
            status: 'read',
            sent,
            delivered: at(base + 1 * MIN),
            read: at(base + 14 * MIN),
            members: null,
          };
        case 'readNoTime':
          // A message from the history import: WhatsApp says read, but not when.
          return { status: 'read', sent: noTime, delivered: noTime, read: noTime, members: null };
        case 'sentOnly':
          return { status: 'sent', sent, delivered: NO, read: NO, members: null };
        case 'pending':
          return {
            status: 'pending',
            sent: NO,
            delivered: NO,
            read: NO,
            members: group ? [] : null,
          };
        case 'failed':
          return {
            status: 'failed',
            sent: NO,
            delivered: NO,
            read: NO,
            members: group ? [] : null,
          };
        case 'groupSeveral':
          return {
            status: 'delivered',
            sent,
            delivered: NO,
            read: NO,
            members: members(base, MEMBERS, 'mixed'),
          };
        case 'groupLongNames':
          return {
            status: 'delivered',
            sent,
            delivered: NO,
            read: NO,
            members: members(base, LONG_MEMBERS, 'mixed'),
          };
        case 'groupNoneYet':
          return {
            status: 'sent',
            sent,
            delivered: NO,
            read: NO,
            members: members(base, MEMBERS, 'none'),
          };
      }
      return { status: row.status, sent, delivered: NO, read: NO, members: null };
    },
  );
}
