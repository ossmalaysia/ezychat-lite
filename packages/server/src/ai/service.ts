import { randomUUID } from 'node:crypto';
import type {
  AiContextPatchBody,
  AiHandoffReason,
  AiDocumentView,
  AiMemberBody,
  AiMemberStatus,
  AiModelList,
  AiTestResult,
  AiTryBody,
  AiTryResult,
  AiSettings,
  Chat,
  ChatEvent,
  Message,
} from '@wa-team-inbox/shared';
import {
  AI_CONTEXT_CHARACTERS,
  AI_CONTEXT_ITEMS,
  AI_CONTEXT_PREVIEW_CHARACTERS,
  AiConnectionBody,
  AiContextTextBody,
  AiDecision,
  CHATGPT_FALLBACK_MODELS,
  DEFAULT_AI_HANDOFF_RULES,
  DEFAULT_AI_INSTRUCTIONS,
  codePointLength,
} from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { errors, parse } from '../http/errors.js';
import { getChats, getMessages } from '../wa-bridge/index.js';
import { AI_KNOWLEDGE_CHARACTERS, relevantKnowledge } from './knowledge.js';
import { OAuthError } from './chatgpt-oauth.js';
import { migrateAiKnowledge, sliceCodePoints } from './migrate.js';
import { createAiProvider } from './provider-factory.js';
import {
  AI_TIMEZONE_SETTING,
  HANDOFF_REPLY,
  VOICE_RETRY_REPLY,
  aiCustomer,
  buildAiPrompt,
  knowledgeSources,
  resolveAiTimeZone,
  type AiContextItem,
  type AiConversationTurn,
  type AiCustomer,
  type AiKnowledge,
} from './prompt.js';
import { OPENAI_DEFAULT_MODEL } from './provider.js';
import type { AiPromptImage, AiProvider } from './provider-types.js';
import { AI_IMAGE_WAIT_MS, AI_LIVE_MEDIA_MS, AI_MAX_IMAGES, readPromptImage } from './images.js';
import { guardResolution, objectsToResolution } from './resolution.js';
import { AI_PROVIDER_KEY, AI_SECRET_KEY } from './settings-keys.js';
import { AI_VOICE_WAIT_MS, conversationLine, customerText, isTranscribed } from './conversation.js';

export const AI_FALLBACK_MS = 10_000;
const PROVIDER_KEY = AI_PROVIDER_KEY;
const MEMBER_KEY = 'ai_sales_member';
const SECRET_KEY = AI_SECRET_KEY;
/** Random per-install id, created once; only its hash (with the model) is sent as prompt_cache_key. */
const INSTALL_ID_KEY = 'ai_install_id';
/** Set once the legacy member knowledge (context, or notes + FAQs) became a context item. */
const CONTEXT_MIGRATED_KEY = 'ai_context_migrated';
const LEGACY_KNOWLEDGE_FIELDS = ['context', 'notes', 'faqs'];
/** The one text item created from legacy member knowledge. */
export const MIGRATED_CONTEXT_NAME = 'Business context';
const DEFAULT_SETTINGS: AiSettings = {
  displayName: 'Sales Agent',
  enabled: false,
  mode: 'api',
  model: '',
  instructions: DEFAULT_AI_INSTRUCTIONS,
  handoffRules: DEFAULT_AI_HANDOFF_RULES,
};
type Actor = { userId: number; ip: string | null };
interface State {
  paused: number;
  awaiting_confirmation: number;
  last_customer_message_id: string | null;
  last_replied_message_id: string | null;
  due_at: number | null;
}

export interface AiService {
  status(): AiMemberStatus;
  saveMember(body: AiMemberBody, actor: Actor): AiMemberStatus;
  saveConnection(body: AiConnectionBody, actor: Actor): AiMemberStatus;
  addDocument(name: string, size: number, text: string, actor: Actor): AiMemberStatus;
  addText(body: AiContextTextBody, actor: Actor): AiMemberStatus;
  updateText(id: number, body: AiContextPatchBody, actor: Actor): AiMemberStatus;
  document(id: number): AiDocumentView;
  removeDocument(id: number, actor: Actor): AiMemberStatus;
  login(): Promise<void>;
  completeSignIn(url: string): Promise<void>;
  logout(): Promise<void>;
  models(): Promise<AiModelList>;
  testConnection(): Promise<AiTestResult>;
  tryAnswer(body: AiTryBody): Promise<AiTryResult>;
  canSend(jid: string, userId: number, quotedId: string | undefined): boolean;
  shutdown(): Promise<void>;
}

declare module '../context.js' {
  interface Services {
    ai?: AiService;
  }
}

export { isResolutionConfirmation } from './resolution.js';

export function createAiService(
  ctx: AppContext,
  deps: { provider?: AiProvider; isOnline?: (id: number) => boolean } = {},
): AiService {
  const provider = deps.provider ?? createAiProvider(ctx);
  const chats = getChats(ctx);
  const messages = getMessages(ctx);
  const log = ctx.log.child({ mod: 'ai' });
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const generations = new Map<string, AbortController>();
  const running = new Set<Promise<void>>();
  let closed = false;
  const member = () => ctx.services.auth!.listUsers().find((user) => user.kind === 'ai') ?? null;
  /**
   * Migration on read: member knowledge stored as one `context` text (or older notes + FAQs)
   * becomes ONE "Business context" text item, then the fields are dropped. The flag makes it
   * idempotent, even if a stale legacy value is written back later.
   */
  const migrateLegacyContext = () => {
    const stored = ctx.settings.get<unknown>(MEMBER_KEY, null);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
    const old = stored as Record<string, unknown>;
    if (!LEGACY_KNOWLEDGE_FIELDS.some((field) => field in old)) return;
    const knowledge = migrateAiKnowledge(old);
    const kept = Object.fromEntries(
      Object.entries(old).filter(([field]) => !LEGACY_KNOWLEDGE_FIELDS.includes(field)),
    );
    let documentId: number | null = null;
    ctx.db.transaction(() => {
      if (!ctx.settings.get<boolean>(CONTEXT_MIGRATED_KEY, false) && knowledge.context.trim()) {
        const now = Date.now();
        documentId = Number(
          ctx.db
            .prepare(
              "INSERT INTO ai_documents(name, kind, size, text, created_at, updated_at) VALUES (?, 'text', ?, ?, ?, ?)",
            )
            .run(
              MIGRATED_CONTEXT_NAME,
              Buffer.byteLength(knowledge.context),
              knowledge.context,
              now,
              now,
            ).lastInsertRowid,
        );
      }
      ctx.settings.set(MEMBER_KEY, { ...kept, instructions: knowledge.instructions });
      ctx.settings.set(CONTEXT_MIGRATED_KEY, true);
    })();
    log.info(
      { event: 'ai_context_migrated', documentId, truncated: knowledge.truncated },
      'Moved stored AI knowledge into a Business context item',
    );
    if (knowledge.truncated)
      log.warn(
        { event: 'ai_context_truncated', limit: AI_CONTEXT_CHARACTERS, unit: 'code_points' },
        'Stored AI knowledge exceeded the text item limit; kept the start',
      );
  };
  const settings = (): AiSettings => {
    const user = member();
    migrateLegacyContext();
    const stored = ctx.settings.get<{ instructions?: unknown; handoffRules?: unknown }>(
      MEMBER_KEY,
      {},
    );
    return {
      ...DEFAULT_SETTINGS,
      // Never saved → the defaults; saved text (even blank) is kept.
      instructions:
        typeof stored?.instructions === 'string' ? stored.instructions : DEFAULT_AI_INSTRUCTIONS,
      handoffRules:
        typeof stored?.handoffRules === 'string' ? stored.handoffRules : DEFAULT_AI_HANDOFF_RULES,
      ...ctx.settings.get<Pick<AiSettings, 'mode' | 'model'>>(PROVIDER_KEY, {
        mode: 'api',
        model: '',
      }),
      displayName: user?.displayName ?? DEFAULT_SETTINGS.displayName,
      enabled: !!user && !user.disabled,
    };
  };
  const installId = () => {
    let id = ctx.settings.get<string | null>(INSTALL_ID_KEY, null);
    if (typeof id !== 'string' || !id) {
      id = randomUUID();
      ctx.settings.set(INSTALL_ID_KEY, id);
    }
    return id;
  };
  /** The cacheable prompt plus this call's facts (time, zone, resolution state) in the last block. */
  const prompt = (
    knowledge: AiKnowledge,
    business: string,
    conversation: AiConversationTurn[],
    awaitingConfirmation: boolean,
    images: readonly AiPromptImage[] = [],
    customer: AiCustomer | null = null,
  ) => ({
    ...buildAiPrompt(
      knowledge,
      business,
      conversation,
      {
        now: new Date(),
        timeZone: resolveAiTimeZone(ctx.settings.get<unknown>(AI_TIMEZONE_SETTING, null)),
        awaitingConfirmation,
      },
      images,
      customer,
    ),
    cacheId: installId(),
  });
  const mediaPending = (id: string) =>
    (
      ctx.db.prepare('SELECT media_status FROM messages WHERE id = ?').get(id) as
        { media_status: string } | undefined
    )?.media_status === 'pending';
  /** Live media is downloaded after the AI is notified: wait (bounded) until it is stored or failed. */
  const waitForMedia = (id: string, signal: AbortSignal, deadline: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timeout);
        ctx.bus.off('message:new', onStored);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const onStored = (message: Message) => {
        if (message.id === id) done();
      };
      const timeout = setTimeout(done, Math.max(0, deadline - Date.now()));
      timeout.unref?.();
      ctx.bus.on('message:new', onStored);
      signal.addEventListener('abort', done, { once: true });
      if (!mediaPending(id) || signal.aborted) done();
    });
  /** The newest readable customer images of a batch (newest first), at most AI_MAX_IMAGES. */
  async function batchImages(batch: readonly Message[], signal: AbortSignal) {
    const images: AiPromptImage[] = [];
    // One wait budget for the whole batch, not per image.
    const deadline = Date.now() + AI_IMAGE_WAIT_MS;
    for (const message of [...batch].reverse()) {
      if (images.length >= AI_MAX_IMAGES || signal.aborted) break;
      if (message.fromMe || message.type !== 'image') continue;
      // Imported history media stays pending until someone opens it: never wait for it.
      if (mediaPending(message.id) && Date.now() - message.timestamp > AI_LIVE_MEDIA_MS) continue;
      await waitForMedia(message.id, signal, deadline);
      const file = messages.mediaPath(message.id);
      const image = file ? readPromptImage(file.path) : null;
      if (image) images.push(image);
    }
    return images.reverse();
  }
  const state = (jid: string) =>
    ctx.db.prepare('SELECT * FROM ai_chat_state WHERE chat_jid = ?').get(jid) as State | undefined;
  /** Every Business context item with its text, oldest first (stable knowledge prefix). */
  const contextItems = () =>
    ctx.db
      .prepare(
        'SELECT id, name, kind, text, created_at AS createdAt FROM ai_documents ORDER BY created_at, id',
      )
      .all() as AiContextItem[];
  const requireMember = () => {
    if (!member()) throw errors.conflict('Add the Sales Agent before adding business context');
  };
  /** Item count and total text limits; `replacing` is the item being edited (not counted). */
  const checkLimits = (adding: string, replacing: number | null) => {
    const total = ctx.db
      .prepare(
        'SELECT count(*) AS count, coalesce(sum(length(text)), 0) AS characters FROM ai_documents WHERE id IS NOT ?',
      )
      .get(replacing) as { count: number; characters: number };
    if (
      (replacing === null && total.count >= AI_CONTEXT_ITEMS) ||
      total.characters + codePointLength(adding) > AI_KNOWLEDGE_CHARACTERS
    )
      throw errors.validation('Business context can contain up to 20 items and 500,000 characters');
  };
  const ready = () =>
    settings().mode === 'api'
      ? !!ctx.settings.getSecret(SECRET_KEY)
      : provider.connection().state === 'connected';
  const cancel = (jid: string) => {
    const timer = timers.get(jid);
    if (timer) clearTimeout(timer);
    timers.delete(jid);
    generations.get(jid)?.abort();
    generations.delete(jid);
    const rows = ctx.db
      .prepare(
        `SELECT m.id, m.client_id FROM messages m JOIN users u ON u.id = m.sent_by_user_id
      WHERE m.chat_jid = ? AND m.status = 'pending' AND u.kind = 'ai'`,
      )
      .all(jid) as Array<{ id: string; client_id: string | null }>;
    for (const row of rows) {
      ctx.db
        .prepare(
          "UPDATE messages SET status = 'failed', error = 'AI reply cancelled' WHERE id = ? AND status = 'pending'",
        )
        .run(row.id);
      ctx.bus.emit('message:status', {
        id: row.id,
        clientId: row.client_id,
        chatJid: jid,
        status: 'failed',
        error: 'AI reply cancelled',
      });
    }
  };
  const cancelAll = () => {
    for (const jid of new Set([...timers.keys(), ...generations.keys()])) cancel(jid);
  };
  const pause = (jid: string) => {
    ctx.db
      .prepare(
        'UPDATE ai_chat_state SET paused = 1, awaiting_confirmation = 0, due_at = NULL WHERE chat_jid = ?',
      )
      .run(jid);
    cancel(jid);
  };
  const releaseOwned = () => {
    const user = member();
    if (!user) return;
    const rows = ctx.db
      .prepare("SELECT jid FROM chats WHERE assigned_to = ? AND status = 'open'")
      .all(user.id) as Array<{ jid: string }>;
    for (const row of rows) {
      pause(row.jid);
      chats.patch(row.jid, { assignedTo: null }, user.id);
    }
  };
  /**
   * The connection itself broke (sign-in expired, or ChatGPT blocked us): stop all AI work and
   * leave its open chats unassigned for the team. Customers are never sent error text.
   */
  const releaseForConnection = () => {
    const user = member();
    if (!user) return;
    cancelAll();
    const rows = ctx.db
      .prepare("SELECT jid FROM chats WHERE assigned_to = ? AND status = 'open'")
      .all(user.id) as Array<{ jid: string }>;
    for (const row of rows) {
      ctx.db.prepare('UPDATE ai_chat_state SET due_at = NULL WHERE chat_jid = ?').run(row.jid);
      chats.patch(row.jid, { assignedTo: null }, user.id);
    }
  };
  provider.onProblem?.(() => {
    if (!closed) releaseForConnection();
  });
  const eligible = (jid: string): boolean => {
    const user = member();
    const chat = chats.get(jid);
    const s = state(jid);
    return (
      !closed &&
      !!user &&
      !user.disabled &&
      ready() &&
      chat?.type === 'dm' &&
      chat.status === 'open' &&
      (chat.assignedTo === null || chat.assignedTo === user.id) &&
      !!s &&
      !s.paused &&
      !!s.last_customer_message_id &&
      s.last_customer_message_id !== s.last_replied_message_id
    );
  };

  function schedule(jid: string, dueAt: number) {
    if (!eligible(jid)) return;
    cancel(jid);
    // Bound automatic work under an inbound burst rather than accumulating unlimited timers.
    if (timers.size >= 200) return;
    const timer = setTimeout(
      () => {
        timers.delete(jid);
        if (running.size >= 3) {
          schedule(jid, Date.now() + 1000);
          return;
        }
        const promise = respond(jid)
          .catch(() => log.warn({ jid, reason: 'workflow_failed' }, 'AI workflow failed'))
          .finally(() => running.delete(promise));
        running.add(promise);
      },
      Math.max(0, dueAt - Date.now()),
    );
    timer.unref?.();
    timers.set(jid, timer);
  }

  function refreshPending() {
    const pending = ctx.db
      .prepare(
        'SELECT chat_jid AS jid, due_at AS dueAt FROM ai_chat_state WHERE paused = 0 AND due_at IS NOT NULL',
      )
      .all() as Array<{ jid: string; dueAt: number }>;
    for (const item of pending)
      if (Date.now() - item.dueAt < 10 * 60_000)
        schedule(item.jid, Math.max(Date.now() + 300, item.dueAt));
  }

  function drainPending() {
    if (closed || !settings().enabled || !ready()) return;
    const pending = ctx.db
      .prepare(
        `SELECT chat_jid AS jid, due_at AS dueAt FROM ai_chat_state
      WHERE paused = 0 AND due_at IS NOT NULL AND due_at >= ? ORDER BY due_at LIMIT 250`,
      )
      .all(Date.now() - 10 * 60_000) as Array<{ jid: string; dueAt: number }>;
    for (const item of pending) {
      if (timers.size >= 200) break;
      if (!timers.has(item.jid) && !generations.has(item.jid))
        schedule(item.jid, Math.max(Date.now() + 300, item.dueAt));
    }
  }
  // Requeue persisted work when ChatGPT finishes restoring or a burst exceeds timer capacity.
  const drainTimer = setInterval(drainPending, 1000);
  drainTimer.unref?.();

  async function sendReply(
    jid: string,
    userId: number,
    customerId: string,
    text: string,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const clientId = `ai-${randomUUID()}`;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        ctx.bus.off('message:status', onStatus);
        signal.removeEventListener('abort', onAbort);
      };
      const onStatus = (event: { clientId: string | null; status: string }) => {
        if (event.clientId !== clientId) return;
        if (['sent', 'delivered', 'read'].includes(event.status)) {
          cleanup();
          resolve();
        } else if (event.status === 'failed') {
          cleanup();
          reject(new Error('AI send failed'));
        }
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('AI reply cancelled', 'AbortError'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('AI send timed out'));
      }, 65_000);
      timeout.unref?.();
      ctx.bus.on('message:status', onStatus);
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        messages.sendText(jid, { text, clientId, quotedId: customerId }, userId);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
    signal.throwIfAborted();
  }

  function handoff(jid: string, userId: number, reason: AiHandoffReason | null) {
    // Selection and assignment are synchronous, so simultaneous handoffs cannot choose the same idle agent.
    const candidates = ctx.db
      .prepare(
        `SELECT u.id FROM users u WHERE u.kind = 'human' AND u.role = 'agent' AND u.disabled_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.assigned_to = u.id AND c.status = 'open') ORDER BY u.id`,
      )
      .all() as Array<{ id: number }>;
    const idle = candidates.find((user) =>
      (deps.isOnline ?? ((id) => ctx.services.realtime?.isOnline(id) ?? false))(user.id),
    );
    pause(jid);
    chats.patch(jid, { assignedTo: idle?.id ?? null }, userId, { handoff: reason });
    audit(ctx.db, {
      userId,
      action: 'ai.handoff',
      ip: null,
      meta: { chatJid: jid, assignedTo: idle?.id ?? null, reason },
    });
  }

  async function respond(jid: string) {
    if (!eligible(jid)) return;
    const user = member()!;
    const customerId = state(jid)!.last_customer_message_id!;
    const controller = new AbortController();
    generations.set(jid, controller);
    const owned = () =>
      !controller.signal.aborted &&
      chats.get(jid)?.assignedTo === user.id &&
      state(jid)?.last_customer_message_id === customerId &&
      !state(jid)?.paused &&
      !member()?.disabled;
    try {
      if (chats.get(jid)!.assignedTo === null) chats.patch(jid, { assignedTo: user.id }, user.id);
      if (!owned()) return;
      const current = settings();
      /** The last 20 messages, the customer message being answered and its debounce batch. */
      const snapshot = () => {
        const history = messages.list(jid, { limit: 20 }).messages;
        const customer = history.find((message) => message.id === customerId);
        if (!customer || customer.fromMe) return null;
        // The debounce batch: every customer message since the last AI reply.
        const repliedIndex = history.findIndex(
          (message) => message.id === state(jid)!.last_replied_message_id,
        );
        const batchStart =
          repliedIndex >= 0
            ? repliedIndex + 1
            : history.findLastIndex((message) => message.fromMe) + 1;
        const batch = history
          .slice(batchStart, history.indexOf(customer) + 1)
          .filter((message) => !message.fromMe);
        return { history, customer, batchStart, batch };
      };
      let snap = snapshot();
      if (!snap) return;
      // Voice notes are transcribed before the AI decides: wait (bounded) for their audio and
      // transcripts, then read the conversation again with the transcripts.
      // Imported history voice notes stay pending until opened and are never transcribed: skip them.
      const voiceNotes = snap.batch.filter(
        (message) =>
          message.type === 'audio' &&
          !(mediaPending(message.id) && Date.now() - message.timestamp > AI_LIVE_MEDIA_MS),
      );
      if (voiceNotes.length) {
        const deadline = Date.now() + AI_VOICE_WAIT_MS;
        for (const note of voiceNotes) {
          await waitForMedia(note.id, controller.signal, deadline);
          await ctx.services.voice?.waitForTranscript(
            note.id,
            controller.signal,
            Math.max(0, deadline - Date.now()),
          );
        }
        if (!owned()) return;
        snap = snapshot();
        if (!snap) return;
      }
      const { history, customer, batchStart, batch } = snap;
      const knowledge = relevantKnowledge(
        knowledgeSources(contextItems()),
        history
          .filter((message) => !message.fromMe)
          .slice(-3)
          .map(customerText)
          .join('\n'),
      );
      // awaiting_confirmation counts the resolution questions already sent in a row.
      const asked = state(jid)!.awaiting_confirmation;
      const awaiting = asked > 0;
      let decision: AiDecision;
      let images: AiPromptImage[] = [];
      const started = Date.now();
      try {
        // Text, images (with or without a caption) and voice notes can be handled; video,
        // documents, stickers and the like go to the team.
        const voice = customer.type === 'audio';
        const readable = customer.type === 'text' || customer.type === 'image' || voice;
        if (readable && knowledge.trim()) images = await batchImages(batch, controller.signal);
        if (!owned()) return;
        const understood =
          !!customer.body?.trim() || (customer.type === 'image' && images.length > 0) || voice;
        // An untranscribed voice note gets one "please type it" answer; a second one after
        // that request goes to the team.
        const customerIndex = history.indexOf(customer);
        const voiceRepeat =
          voice &&
          !isTranscribed(customer) &&
          history
            .slice(0, batchStart)
            .some(
              (message, index) =>
                !message.fromMe &&
                message.type === 'audio' &&
                !isTranscribed(message) &&
                history
                  .slice(index + 1, customerIndex)
                  .some((reply) => reply.fromMe && reply.sentByUserId === user.id),
            );
        decision =
          !readable || !understood || !knowledge.trim() || voiceRepeat
            ? {
                action: 'handoff' as const,
                reply: HANDOFF_REPLY,
                handoffReason: knowledge.trim() ? 'unsupported_message' : 'missing_facts',
              }
            : AiDecision.parse(
                await provider.generate(
                  current,
                  ctx.settings.getSecret(SECRET_KEY),
                  prompt(
                    current,
                    knowledge,
                    history.map((message) => ({
                      speaker: message.fromMe
                        ? message.sentByUserId === user.id
                          ? 'AI'
                          : 'human'
                        : 'customer',
                      text: conversationLine(message),
                    })),
                    awaiting,
                    images,
                    aiCustomer(ctx.services.customers?.profile(jid).profile ?? null),
                  ),
                  controller.signal,
                ),
              );
        // The first voice note the AI could not listen to always gets the "please type it" answer
        // (a repeat was handed off above); only a request for a person or a sensitive topic
        // still hands off.
        if (
          voice &&
          !voiceRepeat &&
          !isTranscribed(customer) &&
          decision.action === 'handoff' &&
          decision.handoffReason !== 'asked_for_human' &&
          decision.handoffReason !== 'sensitive'
        )
          decision = { action: 'answer', reply: VOICE_RETRY_REPLY, handoffReason: null };
      } catch {
        if (controller.signal.aborted) return;
        if (!ready()) {
          log.warn({ jid, reason: 'connection_unavailable' }, 'AI connection unavailable');
          releaseForConnection();
          return;
        }
        log.warn({ jid, reason: 'provider_failed' }, 'AI answer unavailable');
        decision = {
          action: 'handoff' as const,
          reply: HANDOFF_REPLY,
          handoffReason: 'ai_unavailable',
        };
      }
      if (!owned()) return;
      // Judge every customer message since the last AI reply (the debounce batch), not only the
      // latest, so "No, still not working" + "thanks" never closes the chat.
      const batchText = batch.map(customerText).join('\n');
      const conversationText = history
        .filter((message) => !message.fromMe)
        .map(customerText)
        .join('\n');
      const proposed = decision.action;
      decision = guardResolution(decision, asked, batchText, conversationText);
      // One line per decision (no message text) so a chat's AI behaviour can be traced from the log.
      log.info(
        {
          jid,
          action: decision.action,
          proposed,
          handoffReason: decision.handoffReason ?? null,
          asked,
          images: images.length,
          voiceNotes: voiceNotes.length,
          model: current.model ?? null,
          ms: Date.now() - started,
        },
        'AI decision',
      );
      // Consecutive resolution questions: a new question or objection restarts the count at 1.
      const nextAsked =
        decision.action !== 'ask_resolution' ? 0 : objectsToResolution(batchText) ? 1 : asked + 1;
      await sendReply(jid, user.id, customerId, decision.reply, controller.signal);
      if (!owned()) return;
      ctx.db
        .prepare(
          'UPDATE ai_chat_state SET last_replied_message_id = ?, awaiting_confirmation = ?, due_at = NULL WHERE chat_jid = ?',
        )
        .run(customerId, nextAsked, jid);
      if (decision.action === 'handoff') handoff(jid, user.id, decision.handoffReason ?? null);
      else if (decision.action === 'resolve') {
        chats.patch(jid, { status: 'resolved' }, user.id);
        audit(ctx.db, { userId: user.id, action: 'ai.resolve', ip: null, meta: { chatJid: jid } });
      }
    } catch {
      if (owned()) {
        log.warn({ jid, reason: 'send_failed' }, 'AI reply could not be sent');
        handoff(jid, user.id, 'ai_unavailable');
      }
    } finally {
      if (generations.get(jid) === controller) generations.delete(jid);
    }
  }

  const onInbound = ({ chat, message }: { chat: Chat; message: Message }) => {
    const user = member();
    if (
      !user ||
      user.disabled ||
      chat.type !== 'dm' ||
      chat.status !== 'open' ||
      (chat.assignedTo !== null && chat.assignedTo !== user.id)
    )
      return;
    if (state(chat.jid)?.paused) return;
    const dueAt = Date.now() + (chat.assignedTo === user.id ? 300 : AI_FALLBACK_MS);
    ctx.db
      .prepare(
        `INSERT INTO ai_chat_state(chat_jid, last_customer_message_id, due_at) VALUES (?, ?, ?)
      ON CONFLICT(chat_jid) DO UPDATE SET last_customer_message_id = excluded.last_customer_message_id, due_at = excluded.due_at`,
      )
      .run(chat.jid, message.id, dueAt);
    schedule(chat.jid, dueAt);
  };
  const onMessage = (message: Message) => {
    if (!message.fromMe || message.sentByUserId === member()?.id) return;
    const s = state(message.chatJid);
    if (!s?.last_customer_message_id) return;
    const customer = ctx.db
      .prepare('SELECT timestamp FROM messages WHERE id = ?')
      .get(s.last_customer_message_id) as { timestamp: number } | undefined;
    // Ignore old history echoes. A current phone reply also counts as a human response.
    if (customer && message.timestamp >= customer.timestamp) pause(message.chatJid);
  };
  const onReceived = (event: { chat: Chat; message: Message }) => {
    if (event.message.fromMe) onMessage(event.message);
    else onInbound(event);
  };
  const onChat = (chat: Chat) => {
    if (chat.status === 'resolved') {
      cancel(chat.jid);
      ctx.db.prepare('DELETE FROM ai_chat_state WHERE chat_jid = ?').run(chat.jid);
    } else if (chat.assignedTo !== null && chat.assignedTo !== member()?.id) pause(chat.jid);
  };
  const onChatEvent = (event: ChatEvent) => {
    const user = member();
    if (!user || event.actorId === user.id) return;
    if (event.type === 'assigned' && event.payload.assignedTo === user.id) {
      ctx.db
        .prepare(
          'UPDATE ai_chat_state SET paused = 0, awaiting_confirmation = 0 WHERE chat_jid = ?',
        )
        .run(event.chatJid);
      // chat:event is emitted before chat:updated; wait until ownership has committed.
      queueMicrotask(() => {
        if (!closed) schedule(event.chatJid, Date.now() + 300);
      });
    } else if (event.type === 'unassigned' && event.payload.reason !== 'resolved') {
      ctx.db.prepare('UPDATE ai_chat_state SET paused = 0 WHERE chat_jid = ?').run(event.chatJid);
    }
  };
  const onDisabled = (id: number) => {
    if (id === member()?.id) {
      cancelAll();
      releaseOwned();
    }
  };
  ctx.bus
    .on('message:received', onReceived)
    .on('message:new', onMessage)
    .on('chat:updated', onChat)
    .on('chat:event', onChatEvent)
    .on('user:disabled', onDisabled);

  const service: AiService = {
    status() {
      const current = settings();
      const documents = ctx.db
        .prepare(
          `SELECT id, name, kind, size, length(text) AS characters, created_at AS createdAt,
          updated_at AS updatedAt FROM ai_documents ORDER BY created_at, id`,
        )
        .all() as AiMemberStatus['documents'];
      return {
        member: member(),
        settings: current,
        hasApiKey: !!ctx.settings.getSecret(SECRET_KEY),
        documents,
        connection:
          current.mode === 'chatgpt'
            ? provider.connection()
            : { state: ready() ? 'connected' : 'signed_out', loginUrl: null, error: null },
      };
    },
    saveMember(body, actor) {
      if (body.enabled && !ready())
        throw errors.validation(
          'Configure the inbox AI connection before enabling the Sales Agent',
        );
      const hasContext = !!ctx.db
        .prepare('SELECT 1 FROM ai_documents WHERE length(trim(text)) > 0 LIMIT 1')
        .get();
      // The AI answers only from business facts, so instructions alone cannot turn it on.
      if (body.enabled && !hasContext)
        throw errors.validation('Add business context before turning on the AI member');
      cancelAll();
      ctx.db.transaction(() => {
        const user = member();
        if (user)
          ctx.db
            .prepare('UPDATE users SET display_name = ?, disabled_at = ? WHERE id = ?')
            .run(body.displayName, body.enabled ? null : Date.now(), user.id);
        else
          ctx.db
            .prepare(
              "INSERT INTO users(username, display_name, password_hash, role, kind, disabled_at, created_at) VALUES (?, ?, '', 'agent', 'ai', ?, ?)",
            )
            .run(
              `ai-${randomUUID()}`,
              body.displayName,
              body.enabled ? null : Date.now(),
              Date.now(),
            );
        const before = settings();
        // Older clients send no rules: keep the effective ones.
        const handoffRules = body.handoffRules ?? before.handoffRules;
        ctx.settings.set(MEMBER_KEY, {
          displayName: body.displayName,
          instructions: body.instructions,
          handoffRules,
        });
        // Record who changed the AI's behaviour, without copying the text into the audit log.
        audit(ctx.db, {
          ...actor,
          action: 'ai.member_update',
          meta: {
            enabled: body.enabled,
            role: 'sales',
            instructionsChanged: body.instructions !== before.instructions,
            handoffRulesChanged: handoffRules !== before.handoffRules,
          },
        });
      })();
      if (!body.enabled) {
        ctx.bus.emit('user:disabled', member()!.id);
        releaseOwned();
      } else refreshPending();
      return service.status();
    },
    saveConnection(body, actor) {
      body = parse(AiConnectionBody, body);
      if (body.mode === 'chatgpt' && body.model) {
        const known: readonly string[] = provider.knownModels?.() ?? CHATGPT_FALLBACK_MODELS;
        if (!known.includes(body.model))
          throw errors.validation(
            `ChatGPT mode supports ${known.join(', ')}. Choose Auto to use the default.`,
          );
      }
      cancelAll();
      ctx.db.transaction(() => {
        ctx.settings.set(PROVIDER_KEY, { mode: body.mode, model: body.model });
        if (body.apiKey) ctx.settings.setSecret(SECRET_KEY, body.apiKey);
        audit(ctx.db, {
          ...actor,
          action: 'ai.connection_update',
          meta: { mode: body.mode, model: body.model },
        });
      })();
      // A changed connection does not continue an old provider's conversations silently.
      releaseOwned();
      refreshPending();
      return service.status();
    },
    addDocument(name, size, text, actor) {
      requireMember();
      ctx.db.transaction(() => {
        checkLimits(text, null);
        const now = Date.now();
        const result = ctx.db
          .prepare(
            "INSERT INTO ai_documents(name, kind, size, text, created_at, updated_at) VALUES (?, 'file', ?, ?, ?, ?)",
          )
          .run(name, size, text, now, now);
        audit(ctx.db, {
          ...actor,
          action: 'ai.document_add',
          meta: { documentId: Number(result.lastInsertRowid), kind: 'file', size },
        });
      })();
      cancelAll();
      refreshPending();
      return service.status();
    },
    addText(body, actor) {
      const { name, text } = parse(AiContextTextBody, body);
      requireMember();
      const size = Buffer.byteLength(text);
      ctx.db.transaction(() => {
        checkLimits(text, null);
        const now = Date.now();
        const result = ctx.db
          .prepare(
            "INSERT INTO ai_documents(name, kind, size, text, created_at, updated_at) VALUES (?, 'text', ?, ?, ?, ?)",
          )
          .run(name, size, text, now, now);
        audit(ctx.db, {
          ...actor,
          action: 'ai.document_add',
          meta: { documentId: Number(result.lastInsertRowid), kind: 'text', size },
        });
      })();
      cancelAll();
      refreshPending();
      return service.status();
    },
    updateText(id, body, actor) {
      ctx.db.transaction(() => {
        const row = ctx.db
          .prepare('SELECT kind, name, text FROM ai_documents WHERE id = ?')
          .get(id) as { kind: 'file' | 'text'; name: string; text: string } | undefined;
        if (!row) throw errors.notFound('Document');
        if (row.kind !== 'text')
          throw errors.validation('Only text content can be edited. Upload a new file instead.');
        const name = body.name ?? row.name;
        const text = body.text ?? row.text;
        if (body.text !== undefined) checkLimits(text, id);
        const size = Buffer.byteLength(text);
        ctx.db
          .prepare(
            'UPDATE ai_documents SET name = ?, text = ?, size = ?, updated_at = ? WHERE id = ?',
          )
          .run(name, text, size, Date.now(), id);
        audit(ctx.db, {
          ...actor,
          action: 'ai.document_update',
          meta: {
            documentId: id,
            size,
            renamed: body.name !== undefined,
            edited: body.text !== undefined,
          },
        });
      })();
      cancelAll();
      refreshPending();
      return service.status();
    },
    document(id) {
      const row = ctx.db
        .prepare(
          `SELECT id, name, kind, size, length(text) AS characters, created_at AS createdAt,
          updated_at AS updatedAt, text FROM ai_documents WHERE id = ?`,
        )
        .get(id) as Omit<AiDocumentView, 'truncated'> | undefined;
      if (!row) throw errors.notFound('Document');
      // Text items are edited in full; a file shows a read-only preview of its extracted text.
      const truncated = row.kind === 'file' && row.characters > AI_CONTEXT_PREVIEW_CHARACTERS;
      return {
        ...row,
        text: truncated ? sliceCodePoints(row.text, AI_CONTEXT_PREVIEW_CHARACTERS) : row.text,
        truncated,
      };
    },
    removeDocument(id, actor) {
      ctx.db.transaction(() => {
        if (!ctx.db.prepare('DELETE FROM ai_documents WHERE id = ?').run(id).changes)
          throw errors.notFound('Document');
        audit(ctx.db, { ...actor, action: 'ai.document_remove', meta: { documentId: id } });
      })();
      cancelAll();
      refreshPending();
      return service.status();
    },
    async login() {
      await provider.login();
    },
    async completeSignIn(url) {
      if (!provider.submitCallbackUrl)
        throw errors.validation('Pasting a sign-in address is not supported');
      try {
        await provider.submitCallbackUrl(url);
      } catch (error) {
        // Only known OAuth / sign-in messages (fixed, credential-free) reach the admin.
        throw errors.validation(
          error instanceof OAuthError ? error.message : 'ChatGPT sign-in failed. Try again.',
        );
      }
    },
    async logout() {
      cancelAll();
      await provider.logout();
      releaseOwned();
    },
    async models() {
      if (!provider.models) return { models: [], source: 'fallback' };
      return provider.models();
    },
    async testConnection() {
      const current = settings();
      if (current.mode !== 'chatgpt' || !provider.test)
        throw errors.validation('Connection test is available for ChatGPT sign-in only');
      return provider.test(current.model);
    },
    async tryAnswer(body) {
      const current = settings();
      if (!ready())
        return {
          ok: false,
          reply: null,
          action: null,
          model: null,
          error: 'Set up the AI connection in Settings → AI first.',
        };
      // The draft name and instructions, with the saved Business context items.
      const knowledge = relevantKnowledge(knowledgeSources(contextItems()), body.question);
      // Same rule as live replies: with no relevant knowledge the AI hands the chat to a human.
      if (!knowledge.trim())
        return {
          ok: true,
          reply: HANDOFF_REPLY,
          action: 'handoff',
          handoffReason: 'missing_facts',
          model: null,
          error: null,
        };
      let model: string | null = null;
      try {
        model =
          current.mode === 'api'
            ? current.model || OPENAI_DEFAULT_MODEL
            : ((await provider.resolveModel?.(current.model)) ?? current.model);
        const decision = await provider.generate(
          { ...current, ...body.knowledge },
          ctx.settings.getSecret(SECRET_KEY),
          // Draft rules when the page sends them, else the saved ones.
          prompt(
            { handoffRules: current.handoffRules, ...body.knowledge },
            knowledge,
            [{ speaker: 'customer', text: body.question }],
            false,
          ),
          AbortSignal.timeout(60_000),
        );
        // Same gate as live replies; Try it has never asked, so it can never resolve.
        const guarded = guardResolution(decision, 0, body.question);
        return {
          ok: true,
          reply: guarded.reply,
          action: guarded.action,
          handoffReason: guarded.handoffReason ?? null,
          model,
          error: null,
        };
      } catch (error) {
        log.warn({ event: 'ai_try_failed' }, 'AI Try it answer failed');
        return {
          ok: false,
          reply: null,
          action: null,
          model,
          error: error instanceof Error ? error.message : 'The AI could not answer.',
        };
      }
    },
    canSend(jid, userId, quotedId) {
      return (
        eligible(jid) &&
        member()?.id === userId &&
        chats.get(jid)?.assignedTo === userId &&
        !!quotedId &&
        state(jid)?.last_customer_message_id === quotedId
      );
    },
    async shutdown() {
      closed = true;
      clearInterval(drainTimer);
      cancelAll();
      ctx.bus
        .off('message:received', onReceived)
        .off('message:new', onMessage)
        .off('chat:updated', onChat)
        .off('chat:event', onChatEvent)
        .off('user:disabled', onDisabled);
      await provider.shutdown();
      await Promise.allSettled([...running]);
    },
  };
  migrateLegacyContext();
  // Restore only explicitly recorded live inbound work; imported WhatsApp history never creates state.
  const pending = ctx.db
    .prepare(
      'SELECT chat_jid AS jid, due_at AS dueAt FROM ai_chat_state WHERE paused = 0 AND due_at IS NOT NULL',
    )
    .all() as Array<{ jid: string; dueAt: number }>;
  for (const item of pending)
    if (Date.now() - item.dueAt < 10 * 60_000)
      schedule(item.jid, Math.max(Date.now() + 1000, item.dueAt));
  return service;
}

export function initAi(ctx: AppContext) {
  ctx.services.ai = createAiService(ctx);
}
