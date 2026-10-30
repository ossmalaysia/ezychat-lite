import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../packages/server/src/context.js';
import { requireAdmin, requireUser } from '../../../../packages/server/src/auth/guards.js';

/**
 * Ask Ezy (proposal): scripted answers for the interactive mock. The real feature runs one agent turn on
 * the business's AI connection with the MCP tool list and streams each tool step; here every answer is picked
 * from the question's words and the steps are replayed, so each state shows the same way each time. Nothing
 * calls a model.
 */

type Mode = 'normal' | 'slow' | 'error' | 'timeout' | 'expired' | 'no_connection';
type ChangeStatus = 'proposed' | 'applied' | 'discarded';

interface TestResult {
  question: string;
  before: string;
  after: string;
}

interface ChangeBlock {
  type: 'change';
  id: string;
  agent: string;
  title: string;
  target: string;
  summary: string;
  before: string;
  after: string;
  reason: string;
  test?: TestResult;
  status: ChangeStatus;
  version?: number;
}

export type AskBlock =
  | {
      type: 'stats';
      items: Array<{
        label: string;
        value: string;
        note?: string;
        change?: string;
        good?: boolean;
      }>;
    }
  | { type: 'bars'; title: string; finding?: string; rows: Array<{ label: string; count: number }> }
  | { type: 'heatmap'; title: string; finding?: string; hours: number[][] }
  | {
      type: 'chats';
      title: string;
      chats: Array<{
        jid: string;
        name: string;
        preview: string;
        wait: string;
        assignee: string | null;
      }>;
    }
  | {
      type: 'customer';
      jid: string;
      name: string;
      facts: string[];
      points: string[];
      open: string[];
      next: string;
    }
  | ChangeBlock
  | ({ type: 'test' } & TestResult);

interface Answer {
  text: string;
  blocks: AskBlock[];
  /** What Ezy read, as nouns with counts ("inbox statistics (7 days)"). */
  steps: string[];
  followUps: string[];
}

const state: {
  mode: Mode;
  applyConflict: boolean;
  changes: Map<string, ChangeStatus>;
} = {
  mode: 'normal',
  applyConflict: false,
  changes: new Map(),
};

/** The setup version each demo change saves as (fixed, so every screenshot shows the same number). */
const VERSION: Record<string, number> = { 'kb-delivery': 14, 'rule-delivery': 15 };

const FARAH = '60123110021@s.whatsapp.net';

const has = (q: string, words: string[]) => words.some((w) => q.includes(w));

/** Busy hours: weekday (Mon first) × hour; lunch and evening peaks, quiet nights, a Saturday lunch peak. */
function busyHours(): number[][] {
  return Array.from({ length: 7 }, (_, wd) =>
    Array.from({ length: 24 }, (_, h) => {
      if (h < 8 || h > 22) return 0;
      const lunch = h >= 11 && h <= 13 ? 3 : 0;
      const evening = h >= 18 && h <= 20 ? 2 : 0;
      const weekend = wd >= 5 ? 1 : 0;
      const peak = wd === 5 ? (h === 12 ? 3 : h === 11 || h === 13 ? 2 : 0) : 0;
      return 1 + lunch + evening + weekend + peak;
    }),
  );
}

function changeBlocks(): ChangeBlock[] {
  return [
    {
      type: 'change',
      id: 'kb-delivery',
      agent: 'Aina',
      title: 'Delivery to Bayan Lepas',
      target: 'Business context · Delivery areas',
      summary: 'Adds 1 line',
      before: 'We deliver in George Town and Jelutong.',
      after:
        'We deliver in George Town and Jelutong.\nBayan Lepas: RM8, same day for orders before 3 pm.',
      reason: '4 customers asked about Bayan Lepas; Aina had no answer and handed each one off.',
      test: {
        question: 'Ada hantar ke Bayan Lepas tak? Berapa caj?',
        before: 'A human agent will help with your question.',
        after:
          'Ya, kami hantar ke Bayan Lepas: RM8, sampai hari yang sama kalau order sebelum 3 petang.',
      },
      status: state.changes.get('kb-delivery') ?? 'proposed',
    },
    {
      type: 'change',
      id: 'rule-delivery',
      agent: 'Aina',
      title: 'Hand off late orders',
      target: 'Hand-off rules',
      summary: 'Adds 1 rule',
      before: 'Hand off when the customer asks for a refund or is angry.',
      after:
        'Hand off when the customer asks for a refund or is angry.\nIf an order is more than 2 days late, hand off to the team with the order number the customer gave.',
      reason:
        '3 of the 9 hand-offs in the last 7 days were late orders; Aina asked again for an order number the customer had already given.',
      test: {
        question: 'My order #1042 has not arrived yet. It has been 3 days.',
        before: 'Sorry about that! Could you share your order number so I can check?',
        after:
          'Sorry about the wait for order #1042. I have passed it to our team with the order number; they will reply shortly.',
      },
      status: state.changes.get('rule-delivery') ?? 'proposed',
    },
  ];
}

function handoffBars(isAdmin: boolean): AskBlock {
  // A team member sees only the chats of their inboxes, so their numbers are smaller and the title says so.
  return isAdmin
    ? {
        type: 'bars',
        title: 'Hand-offs by reason · all inboxes · last 7 days',
        finding: '4 of the 5 missing facts were about delivery to Bayan Lepas.',
        rows: [
          { label: 'Missing facts', count: 5 },
          { label: 'Order or delivery problem', count: 3 },
          { label: 'Asked for a person', count: 1 },
        ],
      }
    : {
        type: 'bars',
        title: 'Hand-offs by reason · your 2 inboxes · last 7 days',
        finding: '2 of the 3 missing facts were about delivery to Bayan Lepas.',
        rows: [
          { label: 'Missing facts', count: 3 },
          { label: 'Order or delivery problem', count: 2 },
          { label: 'Asked for a person', count: 1 },
        ],
      };
}

interface ChatFacts {
  name: string;
  messages: number;
}

/** A short scripted summary of any demo chat other than Farah's (her chat has the detailed one). */
function genericSummary(jid: string, facts: ChatFacts): Answer {
  return {
    text: `Here is ${facts.name} in short.`,
    steps: [
      `the chat (${facts.messages} ${facts.messages === 1 ? 'message' : 'messages'})`,
      'the customer profile',
    ],
    blocks: [
      {
        type: 'customer',
        jid,
        name: facts.name,
        facts: [`${facts.messages} ${facts.messages === 1 ? 'message' : 'messages'}`, 'No tags'],
        points: ['Asked about the menu and opening hours.'],
        open: ['Waiting for an answer to the last question.'],
        next: 'Answer the last question, then offer today’s set menu.',
      },
    ],
    followUps: ['Which customers wait for a reply?'],
  };
}

function answer(
  question: string,
  isAdmin: boolean,
  chatJid: string | null,
  facts: ChatFacts | null,
  named: (ChatFacts & { jid: string }) | null,
): Answer {
  const q = question.toLowerCase();
  if (chatJid && chatJid !== FARAH && facts) return genericSummary(chatJid, facts);
  if (!chatJid && named) return genericSummary(named.jid, named);
  if (chatJid || has(q, ['summar', 'farah', 'ringkas', 'latest chat'])) {
    const count = facts?.messages ?? 4;
    return {
      text: 'Here is Farah Aziz in short: a catering order for 30 people this Saturday, and the deposit is not confirmed yet.',
      steps: [`the chat (${count} messages)`, 'the customer profile', '1 team note'],
      blocks: [
        {
          type: 'customer',
          jid: chatJid ?? FARAH,
          name: 'Farah Aziz',
          facts: [
            'Farah Catering Co',
            `${count} messages`,
            'Tags: VIP, Catering',
            'Assigned to Mei Ling',
          ],
          points: [
            'Asked to book catering for 30 people this Saturday.',
            'Aisyah replied: RM12 per person; the deposit is to be confirmed today.',
            'Team note: repeat customer, confirm the deposit with staff.',
          ],
          open: ['The deposit is not confirmed yet.'],
          next: 'Confirm the deposit with Farah today.',
        },
      ],
      followUps: ['What should I reply to Farah?', 'Which customers wait for a reply?'],
    };
  }
  if (has(q, ['reply to', 'balas kepada'])) {
    return {
      text: 'A reply you can copy (Ezy never sends it): "Hi Farah, thank you! Catering for 30 this Saturday is RM12 per person (RM360). Please send the deposit today, then I will confirm the menu."',
      steps: ['the chat (4 messages)', '1 team note'],
      blocks: [],
      followUps: ['Which customers wait for a reply?'],
    };
  }
  if (has(q, ['fix', 'improve', 'rule', 'knowledge', 'baiki'])) {
    if (!isAdmin)
      return {
        text: 'Only an admin can change the AI agent. Here is why chats in your inboxes were handed off. A message you can send to your admin: "Aina handed off 6 chats this week, most about delivery to Bayan Lepas and late orders. Please add the Bayan Lepas delivery fee to the Business context and a rule to hand off late orders with the order number."',
        steps: ['hand-offs in your 2 inboxes (7 days, 6 chats)'],
        blocks: [handoffBars(isAdmin)],
        followUps: ['Which customers wait for a reply?'],
      };
    return {
      text: 'I found 2 changes for Aina. Each one is tested with a real question. Nothing changes until you press Apply, and you can undo it.',
      steps: ['hand-offs (7 days, 9 chats)', 'Aina’s setup', '2 test replies'],
      blocks: changeBlocks(),
      followUps: ['Which customers wait for a reply?', 'How is my inbox this week?'],
    };
  }
  if (has(q, ['test', 'uji'])) {
    const kb = changeBlocks()[0]!;
    const test = kb.test!;
    return {
      text:
        kb.status === 'applied'
          ? 'The delivery change is applied. Here is how Aina answered before it and how she answers now.'
          : 'Here is how Aina answers the same customer question before and after the delivery change.',
      steps: ['Aina’s setup', '1 test reply'],
      blocks: [
        {
          type: 'test',
          question: test.question,
          before: test.before,
          after: test.after,
        },
      ],
      followUps: ['How is my inbox this week?'],
    };
  }
  if (has(q, ['hand', 'serah', 'why'])) {
    return {
      text: isAdmin
        ? 'Aina handed off 9 chats in the last 7 days. Most of them needed a fact that is not in the Business context.'
        : 'In your 2 inboxes, Aina handed off 6 chats in the last 7 days. Most of them needed a fact that is not in the Business context.',
      steps: [
        isAdmin ? 'hand-offs (7 days, 9 chats)' : 'hand-offs in your 2 inboxes (7 days, 6 chats)',
      ],
      blocks: [handoffBars(isAdmin)],
      followUps: isAdmin
        ? ['Fix my knowledge and hand-off rules', 'Which customers wait for a reply?']
        : ['Which customers wait for a reply?'],
    };
  }
  if (has(q, ['busy', 'when', 'sibuk', 'bila'])) {
    return {
      text: 'Saturday around lunchtime is the busiest time for new conversations: the three busiest hours are all on Saturday.',
      steps: ['activity (28 days)'],
      blocks: [
        {
          type: 'heatmap',
          title: 'New conversations by hour · last 28 days',
          hours: busyHours(),
        },
      ],
      followUps: ['How is my inbox this week?'],
    };
  }
  if (has(q, ['wait', 'reply', 'tunggu', 'balas'])) {
    return {
      text: '3 customers wait for a reply. Priya Nair waits the longest.',
      steps: ['open chats waiting for the team (3)'],
      blocks: [
        {
          type: 'chats',
          title: 'Waiting for a reply',
          chats: [
            {
              jid: '60128814455@s.whatsapp.net',
              name: 'Priya Nair',
              preview: 'My order #1042 has not arrived yet.',
              wait: '42 min',
              assignee: null,
            },
            {
              jid: '60131234567@s.whatsapp.net',
              name: 'Siti Rahman',
              preview: 'Ada hantar ke Bayan Lepas tak? Berapa caj?',
              wait: '15 min',
              assignee: null,
            },
            {
              jid: '60125550142@s.whatsapp.net',
              name: 'Ahmad Zulkifli',
              preview: 'Is the shop open on Hari Raya?',
              wait: '5 min',
              assignee: null,
            },
          ],
        },
      ],
      followUps: ['Summarise Priya Nair', 'Why does the AI hand off chats?'],
    };
  }
  if (has(q, ['week', 'inbox', 'how is', 'minggu', 'overview'])) {
    return {
      text: 'The last 7 days were good: more new conversations, and Aina answered most questions by herself.',
      steps: ['inbox statistics (7 days)'],
      blocks: [
        {
          type: 'stats',
          items: [
            {
              label: 'New conversations',
              value: '18',
              change: '+4 vs the 7 days before',
              good: true,
            },
            { label: 'Waiting for a reply', value: '3', note: 'Longest: 42 min' },
            {
              label: 'Questions answered by Aina',
              value: '42',
              note: 'A chat can have several questions',
              change: '+11 vs the 7 days before',
              good: true,
            },
            {
              label: 'Handed off to the team',
              value: '9',
              change: '−2 vs the 7 days before',
              good: true,
            },
          ],
        },
      ],
      followUps: ['Why does the AI hand off chats?', 'When do new customers write?'],
    };
  }
  return {
    text: 'I can answer questions about your chats and customers, and (for admins) suggest changes to the AI agent. Try one of these:',
    steps: [],
    blocks: [],
    followUps: [
      'How is my inbox this week?',
      'Which customers wait for a reply?',
      ...(isAdmin ? ['Fix my knowledge and hand-off rules'] : ['Why does the AI hand off chats?']),
    ],
  };
}

const AskBody = z.object({
  question: z.string().trim().min(1).max(2000),
  chatJid: z.string().max(200).nullable().optional(),
});

const ERRORS: Partial<Record<Mode, string>> = {
  error: 'ai_unavailable',
  timeout: 'ai_timeout',
  expired: 'ai_expired',
};

const view = () => ({
  mode: state.mode,
  applyConflict: state.applyConflict,
  connected: state.mode !== 'no_connection',
});

export function registerAskEzy(app: FastifyInstance, ctx: AppContext): void {
  const isAdmin = (userId: number) => ctx.services.auth?.getUser(userId)?.role === 'admin';

  app.get('/api/mock/ask-ezy/state', { preHandler: requireUser(ctx) }, async () => view());
  app.put('/api/mock/ask-ezy/state', { preHandler: requireAdmin(ctx) }, async (request) => {
    const body = z
      .object({
        mode: z.enum(['normal', 'slow', 'error', 'timeout', 'expired', 'no_connection']).optional(),
        applyConflict: z.boolean().optional(),
      })
      .parse(request.body);
    if (body.mode) state.mode = body.mode;
    if (body.applyConflict !== undefined) state.applyConflict = body.applyConflict;
    return view();
  });

  /**
   * One question, streamed as NDJSON lines: `{type:'step', label}` for each tool Ezy uses, then
   * `{type:'answer', answer}` or `{type:'error', code}`. Closing the request stops it.
   */
  app.post('/api/mock/ask-ezy', { preHandler: requireUser(ctx) }, async (request, reply) => {
    const body = AskBody.parse(request.body);
    if (state.mode === 'no_connection')
      return reply
        .code(409)
        .send({ error: { code: 'ai_not_connected', message: 'Connect an AI provider first' } });
    const user = request.user!;
    const jid = body.chatJid ?? null;
    const facts = jid
      ? ((ctx.db
          .prepare(
            `SELECT COALESCE(c.name, c.jid) AS name, (SELECT COUNT(*) FROM messages m WHERE m.chat_jid = c.jid) AS messages
             FROM chats c WHERE c.jid = ?`,
          )
          .get(jid) as ChatFacts | undefined) ?? null)
      : null;
    // "Summarise Priya Nair": a demo chat whose first name is in the question.
    const named = jid
      ? null
      : ((ctx.db
          .prepare(
            `SELECT c.jid AS jid, COALESCE(c.name, c.jid) AS name,
                    (SELECT COUNT(*) FROM messages m WHERE m.chat_jid = c.jid) AS messages
             FROM chats c
             WHERE c.type = 'dm' AND c.jid <> ? AND c.name IS NOT NULL
               AND instr(c.name || ' ', ' ') > 3
               AND instr(lower(?), lower(substr(c.name, 1, instr(c.name || ' ', ' ') - 1))) > 0
             LIMIT 1`,
          )
          .get(FARAH, body.question) as (ChatFacts & { jid: string }) | undefined) ?? null);
    const result = answer(body.question, isAdmin(user.id), jid, facts, named);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    });
    let closed = false;
    request.raw.on('close', () => (closed = true));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const stepMs = state.mode === 'slow' ? 1600 : 350;
    for (const label of result.steps.length ? result.steps : ['your question']) {
      if (closed) return;
      raw.write(JSON.stringify({ type: 'step', label }) + '\n');
      await wait(stepMs);
    }
    if (closed) return;
    const failure = ERRORS[state.mode];
    raw.end(
      JSON.stringify(
        failure ? { type: 'error', code: failure } : { type: 'answer', answer: result },
      ) + '\n',
    );
  });

  app.post(
    '/api/mock/ask-ezy/changes/:id/:action',
    { preHandler: requireAdmin(ctx) },
    async (request, reply) => {
      const { id, action } = z
        .object({
          id: z.enum(['rule-delivery', 'kb-delivery']),
          action: z.enum(['apply', 'discard', 'undo']),
        })
        .parse(request.params);
      if (action === 'apply') {
        if (state.applyConflict)
          return reply.code(409).send({
            error: { code: 'setup_changed', message: 'The setup changed since Ezy read it' },
          });
        state.changes.set(id, 'applied');
        return { status: 'applied', version: VERSION[id] };
      }
      state.changes.set(id, action === 'discard' ? 'discarded' : 'proposed');
      return { status: state.changes.get(id) };
    },
  );
}
