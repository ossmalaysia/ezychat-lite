import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Message } from '@ezychat/shared';
import type { FakeWaAdapter } from '@ezychat/wa';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireAdmin, requireUser } from '../../../../packages/server/src/auth/guards.js';

/**
 * Proposed (whatsapp-safety), mock only: WhatsApp Safety. Every incoming message is checked by
 * local rules (file type, files inside a ZIP, fake double extensions, risky wording, lookalike links);
 * when something is found and the AI check is on, the AI (fast model) scores the same message from
 * its text, file names and the ZIP's file list only (never the file itself). The final level decides
 * the action: Warning = banner + confirm before download; High = banner + file locked for agents
 * (quarantine) + admin alert; auto-block (off by default) only on a Critical rule from a number that
 * is not an existing customer.
 *
 * Stand-in state and routes `/api/mock/safety*`. The scenarios carry their rule findings and AI
 * answer as fixed demo data (no model is called); `decide()` is the proposed policy itself.
 * Production: `safety/rules.ts`, `safety/ai-check.ts`, table `safety_items`, `WaAdapter.blockNumber`.
 */

type Level = 'none' | 'warning' | 'high';
type Status = 'open' | 'safe' | 'reported' | 'blocked' | 'cleared';

/** Rule signals and their points; `critical` means High whatever the score. */
export const RULES = {
  exeInZip: { points: 0, critical: true },
  executable: { points: 0, critical: true },
  doubleExtension: { points: 0, critical: true },
  scamNumber: { points: 0, critical: true },
  cantInspect: { points: 40, critical: false },
  macroFile: { points: 40, critical: false },
  passwordInMessage: { points: 25, critical: false },
  openOnComputer: { points: 25, critical: false },
  lookalikeLink: { points: 25, critical: false },
  financeUrgency: { points: 20, critical: false },
  firstFile: { points: 15, critical: false },
} as const;
type RuleCode = keyof typeof RULES;

interface AiAnswer {
  level: Level;
  category: 'malware_lure' | 'phishing' | 'impersonation' | 'payment_fraud' | 'none';
  /** Translation key of the AI's one-line reason (production: written by the AI in the team's language). */
  reason: string;
}

interface Scenario {
  chatJid: string;
  senderName: string;
  body: string;
  file: { name: string; mime: string; inside: string[] } | null;
  rules: RuleCode[];
  ai: AiAnswer;
}

const SCENARIOS = {
  zipLure: {
    chatJid: '601123456789@s.whatsapp.net',
    senderName: 'Accounts Dept',
    body: 'Good afternoon. Please forward this statement of account to your finance manager for review. Kindly open it on a laptop or desktop.',
    file: {
      name: 'Statement_of_Account_Oct2026.zip',
      mime: 'application/zip',
      inside: ['Statement_of_Account_Oct2026.pdf.vbs'],
    },
    rules: ['exeInZip', 'doubleExtension', 'financeUrgency', 'openOnComputer', 'firstFile'],
    ai: { level: 'high', category: 'malware_lure', reason: 'zipLure' },
  },
  hackedCustomer: {
    chatJid: '60129001234@s.whatsapp.net',
    senderName: 'Jason Lim',
    body: 'Hi boss, payment slip attached. Please check urgently.',
    file: { name: 'Payment_Slip.zip', mime: 'application/zip', inside: ['Payment_Slip.pdf.js'] },
    rules: ['exeInZip', 'doubleExtension', 'financeUrgency', 'firstFile'],
    ai: { level: 'high', category: 'malware_lure', reason: 'hackedCustomer' },
  },
  phishingLink: {
    chatJid: '60198887766@s.whatsapp.net',
    senderName: 'Maybank2u',
    body: 'Maybank2u: Your account is suspended. Verify within 24 hours at https://maybank2u-secure.my-verify.top/login',
    file: null,
    rules: ['lookalikeLink', 'financeUrgency'],
    ai: { level: 'high', category: 'phishing', reason: 'phishingLink' },
  },
  macroDoc: {
    chatJid: '60128814455@s.whatsapp.net',
    senderName: 'Priya Nair',
    body: 'Updated order list for next week attached.',
    file: {
      name: 'Order_list_Nov.xlsm',
      mime: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      inside: [],
    },
    rules: ['macroFile'],
    ai: { level: 'warning', category: 'none', reason: 'macroDoc' },
  },
  lockedArchive: {
    chatJid: '60175554433@s.whatsapp.net',
    senderName: 'Quotation Team',
    body: 'Quotation as discussed. Password: 2026',
    file: { name: 'Quotation.rar', mime: 'application/vnd.rar', inside: [] },
    rules: ['cantInspect', 'passwordInMessage', 'firstFile'],
    ai: { level: 'high', category: 'malware_lure', reason: 'lockedArchive' },
  },
  falseAlarm: {
    chatJid: '60131234567@s.whatsapp.net',
    senderName: 'Siti Rahman',
    body: 'Urgent: please confirm my payment for order #1188, I already transferred.',
    file: null,
    rules: ['financeUrgency', 'firstFile'],
    ai: { level: 'none', category: 'none', reason: 'falseAlarm' },
  },
} satisfies Record<string, Scenario>;
type ScenarioId = keyof typeof SCENARIOS;
const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

interface Settings {
  enabled: boolean;
  ai: boolean;
  autoBlock: boolean;
  deleteAfterDays: 7 | 30 | 90;
}

interface Item {
  id: string;
  messageId: string;
  chatJid: string;
  phone: string;
  senderName: string;
  scenario: ScenarioId;
  at: number;
  text: string;
  file: { name: string; inside: string[] } | null;
  ruleCodes: RuleCode[];
  ruleScore: number;
  ruleLevel: Level;
  critical: boolean;
  ai: AiAnswer | null;
  level: Level;
  status: Status;
  existingCustomer: boolean;
  quarantined: boolean;
  released: boolean;
  deleted: { by: string; at: number } | null;
  autoBlocked: boolean;
  downloads: Array<{ name: string; at: number }>;
  history: Array<{ action: string; by: string; at: number }>;
}

/** The proposed policy: rules first, the AI may raise or confirm, and lower only a rules-only Warning. */
export function decide(
  rules: readonly RuleCode[],
  ai: AiAnswer | null,
): { score: number; ruleLevel: Level; critical: boolean; level: Level } {
  const critical = rules.some((r) => RULES[r].critical);
  const score = Math.min(
    100,
    rules.reduce((sum, r) => sum + RULES[r].points, 0),
  );
  const ruleLevel: Level = critical || score >= 60 ? 'high' : score >= 30 ? 'warning' : 'none';
  if (!ai) return { score, ruleLevel, critical, level: ruleLevel };
  if (critical) return { score, ruleLevel, critical, level: 'high' };
  const rank = { none: 0, warning: 1, high: 2 } as const;
  if (ruleLevel === 'warning' && ai.level === 'none')
    return { score, ruleLevel, critical, level: 'none' };
  return {
    score,
    ruleLevel,
    critical,
    level: rank[ai.level] > rank[ruleLevel] ? ai.level : ruleLevel,
  };
}

const phoneOf = (jid: string) => {
  const digits = jid.split('@')[0] ?? '';
  return digits.startsWith('60') ? `+60 ${digits.slice(2, 4)}-${digits.slice(4)}` : `+${digits}`;
};

export function registerSafety(app: FastifyInstance, ctx: AppContext, wa: FakeWaAdapter) {
  const settings: Settings = { enabled: true, ai: true, autoBlock: false, deleteAfterDays: 30 };
  const items: Item[] = [];
  /** Numbers the team reported as scam (shared by every inbox). */
  const scam = new Map<string, { by: string; at: number }>();
  const blocked = new Map<string, { by: string; at: number; auto: boolean; name: string }>();
  const trusted = new Set<string>();
  const nameOf = (req: { user?: { displayName: string } }) => req.user?.displayName ?? 'Admin';

  const view = (item: Item) => ({
    ...item,
    scam: scam.has(item.chatJid),
    blocked: blocked.has(item.chatJid),
  });
  const state = () => ({
    settings,
    items: items.map(view).sort((a, b) => b.at - a.at),
    blocked: [...blocked].map(([chatJid, b]) => ({ chatJid, phone: phoneOf(chatJid), ...b })),
    scenarios: SCENARIO_IDS,
  });

  /** Delivers a scenario's message through the fake phone and checks it like the server would. */
  async function deliver(id: ScenarioId, variant = 0): Promise<Item | null> {
    const s: Scenario = SCENARIOS[id];
    // A repeated "new number" scenario comes from another new number (the same lure, resent).
    const newNumber = !['hackedCustomer', 'macroDoc', 'falseAlarm'].includes(id);
    const chatJid =
      newNumber && variant && ctx.services.chats!.get(s.chatJid)
        ? s.chatJid.replace(/\d{2}@/, `${String(10 + variant).slice(-2)}@`)
        : s.chatJid;
    const existingCustomer = Boolean(ctx.services.chats!.get(chatJid));
    const stored = new Promise<Message>((resolve) => {
      const on = (m: Message) => {
        if (m.chatJid === chatJid && !m.fromMe) {
          ctx.bus.off('message:new', on);
          resolve(m);
        }
      };
      ctx.bus.on('message:new', on);
    });
    wa.simulateIncoming({
      chatJid,
      senderName: s.senderName,
      body: s.body,
      type: s.file ? 'document' : 'text',
      media: s.file
        ? {
            mime: s.file.mime,
            fileName: s.file.name,
            // A harmless stand-in: the mock never holds a real harmful file.
            download: async () => Buffer.from('EzyChat mock: harmless stand-in file.\n'),
          }
        : null,
    });
    const message = await stored;
    if (!settings.enabled) return null;
    const rules: RuleCode[] = [...s.rules];
    if (scam.has(chatJid)) rules.unshift('scamNumber');
    if (existingCustomer && id !== 'hackedCustomer') {
      const first = rules.indexOf('firstFile');
      if (first >= 0) rules.splice(first, 1);
    }
    if (trusted.has(`${chatJid}|${s.file ? 'file' : 'text'}`)) return null;
    const found = rules.length > 0;
    const ai = found && settings.ai ? s.ai : null;
    const d = decide(rules, ai);
    const now = Date.now();
    const item: Item = {
      id: `safety-${items.length + 1}`,
      messageId: message.id,
      chatJid,
      phone: phoneOf(chatJid),
      senderName: s.senderName,
      scenario: id,
      at: now,
      text: s.body,
      file: s.file ? { name: s.file.name, inside: s.file.inside } : null,
      ruleCodes: rules,
      ruleScore: d.score,
      ruleLevel: d.ruleLevel,
      critical: d.critical,
      ai,
      level: d.level,
      status: d.level === 'none' ? 'cleared' : 'open',
      existingCustomer,
      quarantined: d.level === 'high' && Boolean(s.file),
      released: false,
      deleted: null,
      autoBlocked: false,
      downloads: [],
      history: [],
    };
    // Auto-block: switch on, a Critical rule, and not an existing customer (hacked customers are warned, not blocked).
    if (settings.autoBlock && d.critical && !existingCustomer) {
      blocked.set(chatJid, { by: 'WhatsApp Safety', at: now, auto: true, name: s.senderName });
      item.autoBlocked = true;
      item.status = 'blocked';
      item.history.push({ action: 'autoBlocked', by: 'WhatsApp Safety', at: now });
    }
    items.push(item);
    return item;
  }

  const find = (id: string) => {
    const item = items.find((i) => i.id === id || i.messageId === id);
    if (!item) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    return item;
  };
  const IdParams = z.object({ id: z.string().min(1).max(200) });

  // Any signed-in user: the flags the chat screen needs (level, reasons, lock), and chat-level marks.
  app.get('/api/mock/safety/flags', { preHandler: requireUser(ctx) }, async () => ({
    enabled: settings.enabled,
    messages: Object.fromEntries(
      items
        .filter((i) => i.level !== 'none')
        .map((i) => [
          i.messageId,
          {
            id: i.id,
            level: i.level,
            ruleCodes: i.ruleCodes,
            ai: i.ai,
            locked: i.quarantined && !i.released && i.status !== 'safe',
            deleted: i.deleted,
            status: i.status,
          },
        ]),
    ),
    chats: Object.fromEntries(
      [...new Set(items.map((i) => i.chatJid))].map((jid) => {
        const latest = items.filter((i) => i.chatJid === jid).at(-1)!;
        return [
          jid,
          {
            itemId: latest.id,
            scam: scam.has(jid),
            blocked: blocked.get(jid) ?? null,
            maybeHacked:
              latest.existingCustomer && latest.level === 'high' && latest.status === 'open',
          },
        ];
      }),
    ),
  }));

  app.get('/api/mock/safety', { preHandler: requireAdmin(ctx) }, async () => state());

  app.put('/api/mock/safety/settings', { preHandler: requireAdmin(ctx) }, async (req) => {
    Object.assign(
      settings,
      z
        .object({
          enabled: z.boolean().optional(),
          ai: z.boolean().optional(),
          autoBlock: z.boolean().optional(),
          deleteAfterDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
        })
        .parse(req.body),
    );
    return state();
  });

  // A teammate downloads a flagged file: agents are refused while it is locked; every download is recorded.
  app.post(
    '/api/mock/safety/download/:id',
    { preHandler: requireUser(ctx) },
    async (req, reply) => {
      const item = find(IdParams.parse(req.params).id);
      if (item.deleted) return reply.code(410).send({ error: 'deleted' });
      const locked = item.quarantined && !item.released && item.status !== 'safe';
      if (locked && req.user!.role !== 'admin') {
        item.history.push({ action: 'downloadRefused', by: req.user!.displayName, at: Date.now() });
        return reply.code(403).send({ error: 'locked' });
      }
      item.downloads.push({ name: req.user!.displayName, at: Date.now() });
      return { ok: true };
    },
  );

  const action = (name: string, run: (item: Item, by: string, body: unknown) => void) =>
    app.post(
      `/api/mock/safety/items/:id/${name}`,
      { preHandler: requireAdmin(ctx) },
      async (req) => {
        const item = find(IdParams.parse(req.params).id);
        const by = nameOf(req as never);
        run(item, by, req.body ?? {});
        item.history.push({ action: name, by, at: Date.now() });
        return state();
      },
    );

  action('safe', (item, _by, body) => {
    item.status = 'safe';
    item.released = true;
    if (z.object({ trust: z.boolean().default(false) }).parse(body).trust)
      trusted.add(`${item.chatJid}|${item.file ? 'file' : 'text'}`);
  });
  action('release', (item) => {
    item.released = true;
  });
  action('delete', (item, by) => {
    item.deleted = { by, at: Date.now() };
    item.quarantined = false;
  });
  action('report', (item, by, body) => {
    const { block } = z.object({ block: z.boolean().default(false) }).parse(body);
    scam.set(item.chatJid, { by, at: Date.now() });
    item.status = 'reported';
    if (block) {
      blocked.set(item.chatJid, { by, at: Date.now(), auto: false, name: item.senderName });
      item.status = 'blocked';
    }
  });
  action('block', (item, by) => {
    blocked.set(item.chatJid, { by, at: Date.now(), auto: false, name: item.senderName });
    item.status = 'blocked';
  });
  action('unblock', (item) => {
    blocked.delete(item.chatJid);
    if (item.status === 'blocked') item.status = scam.has(item.chatJid) ? 'reported' : 'open';
  });

  // Mock only: deliver a scenario now (as if the message just arrived), from the Safety page.
  let runs = 0;
  app.post('/api/mock/safety/simulate', { preHandler: requireAdmin(ctx) }, async (req) => {
    const { scenario } = z
      .object({ scenario: z.enum(SCENARIO_IDS as [ScenarioId, ...ScenarioId[]]) })
      .parse(req.body);
    const item = await deliver(scenario, ++runs);
    return { item: item ? view(item) : null, state: state() };
  });

  return {
    /** Seeded demo items: the lures that arrived "earlier today", before the owner opens the mock. */
    async seed() {
      for (const id of [
        'macroDoc',
        'falseAlarm',
        'phishingLink',
        'hackedCustomer',
        'zipLure',
      ] as const)
        await deliver(id);
      const lure = items.find((i) => i.scenario === 'zipLure')!;
      lure.history.push({ action: 'downloadRefused', by: 'Daniel', at: Date.now() - 4 * 60_000 });
      const macro = items.find((i) => i.scenario === 'macroDoc')!;
      macro.downloads.push({ name: 'Mei Ling', at: Date.now() - 12 * 60_000 });
    },
  };
}
