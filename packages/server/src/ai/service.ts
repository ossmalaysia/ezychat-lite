import { randomUUID } from 'node:crypto';
import type {
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
import { AiConnectionBody, AiDecision, CHATGPT_MODELS } from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { errors, parse } from '../http/errors.js';
import { getChats, getMessages } from '../wa-bridge/index.js';
import { AI_DOCUMENT_LIMIT, AI_KNOWLEDGE_CHARACTERS, relevantKnowledge } from './knowledge.js';
import { OAuthError } from './chatgpt-oauth.js';
import { createAiProvider } from './provider-factory.js';
import { HANDOFF_REPLY, buildAiPrompt, knowledgeSources } from './prompt.js';
import { OPENAI_DEFAULT_MODEL } from './provider.js';
import type { AiProvider } from './provider-types.js';

export const AI_FALLBACK_MS = 10_000;
const PROVIDER_KEY = 'ai_inbox_provider';
const MEMBER_KEY = 'ai_sales_member';
const SECRET_KEY = 'ai_api_key';
const DEFAULT_SETTINGS: AiSettings = {
  displayName: 'Sales Agent',
  enabled: false,
  mode: 'api',
  model: '',
  instructions: '',
  notes: '',
  faqs: [],
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

/** Conservative server-side confirmation gate; a model decision alone cannot close a chat. */
export function isResolutionConfirmation(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase()
    .replace(/[.!?,。！？，]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(yes|yep|yeah|yes thanks|yes thank you|yes resolved|resolved|all sorted|that's all|that is all|that's all thanks|no more questions|ya|ya terima kasih|sudah|sudah selesai|selesai|betul|baik|是|是的|好了|已解决|解决了|谢谢|是的谢谢)$/.test(
    normalized,
  );
}

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
  const settings = (): AiSettings => {
    const user = member();
    return {
      ...DEFAULT_SETTINGS,
      ...ctx.settings.get<Partial<AiSettings>>(MEMBER_KEY, {}),
      ...ctx.settings.get<Pick<AiSettings, 'mode' | 'model'>>(PROVIDER_KEY, {
        mode: 'api',
        model: '',
      }),
      displayName: user?.displayName ?? DEFAULT_SETTINGS.displayName,
      enabled: !!user && !user.disabled,
    };
  };
  const state = (jid: string) =>
    ctx.db.prepare('SELECT * FROM ai_chat_state WHERE chat_jid = ?').get(jid) as State | undefined;
  const documentsText = () =>
    ctx.db.prepare('SELECT name, text FROM ai_documents ORDER BY id').all() as Array<{
      name: string;
      text: string;
    }>;
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

  function handoff(jid: string, userId: number) {
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
    chats.patch(jid, { assignedTo: idle?.id ?? null }, userId);
    audit(ctx.db, {
      userId,
      action: 'ai.handoff',
      ip: null,
      meta: { chatJid: jid, assignedTo: idle?.id ?? null },
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
      const history = messages.list(jid, { limit: 20 }).messages;
      const customer = history.find((message) => message.id === customerId);
      if (!customer || customer.fromMe) return;
      const knowledge = relevantKnowledge(
        knowledgeSources(current, documentsText()),
        history
          .filter((message) => !message.fromMe)
          .slice(-3)
          .map((message) => message.body ?? '')
          .join('\n'),
      );
      const awaiting = state(jid)!.awaiting_confirmation === 1;
      let decision;
      try {
        decision =
          customer.type !== 'text' || !customer.body?.trim() || !knowledge.trim()
            ? { action: 'handoff' as const, reply: HANDOFF_REPLY }
            : AiDecision.parse(
                await provider.generate(
                  current,
                  ctx.settings.getSecret(SECRET_KEY),
                  buildAiPrompt(
                    current,
                    knowledge,
                    history.map((message) => ({
                      speaker: message.fromMe
                        ? message.sentByUserId === user.id
                          ? 'AI'
                          : 'human'
                        : 'customer',
                      text: message.body?.slice(0, 2000) ?? `[${message.type} message]`,
                    })),
                    awaiting,
                  ),
                  controller.signal,
                ),
              );
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
        };
      }
      if (!owned()) return;
      if (
        decision.action === 'resolve' &&
        (!awaiting || !isResolutionConfirmation(customer.body ?? ''))
      ) {
        decision = {
          action: 'ask_resolution',
          reply: 'Has your question been resolved, or is there anything else I can help with?',
        };
      }
      await sendReply(jid, user.id, customerId, decision.reply, controller.signal);
      if (!owned()) return;
      ctx.db
        .prepare(
          'UPDATE ai_chat_state SET last_replied_message_id = ?, awaiting_confirmation = ?, due_at = NULL WHERE chat_jid = ?',
        )
        .run(customerId, decision.action === 'ask_resolution' ? 1 : 0, jid);
      if (decision.action === 'handoff') handoff(jid, user.id);
      else if (decision.action === 'resolve') {
        chats.patch(jid, { status: 'resolved' }, user.id);
        audit(ctx.db, { userId: user.id, action: 'ai.resolve', ip: null, meta: { chatJid: jid } });
      }
    } catch {
      if (owned()) {
        log.warn({ jid, reason: 'send_failed' }, 'AI reply could not be sent');
        handoff(jid, user.id);
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
          'SELECT id, name, size, length(text) AS characters, created_at AS createdAt FROM ai_documents ORDER BY id',
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
      const documentCount = (
        ctx.db.prepare('SELECT count(*) AS n FROM ai_documents').get() as { n: number }
      ).n;
      if (
        body.enabled &&
        !body.instructions.trim() &&
        !body.notes.trim() &&
        !body.faqs.length &&
        !documentCount
      )
        throw errors.validation(
          'Add instructions, notes, FAQs or a document before turning on the AI member',
        );
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
        ctx.settings.set(MEMBER_KEY, {
          displayName: body.displayName,
          instructions: body.instructions,
          notes: body.notes,
          faqs: body.faqs,
        });
        audit(ctx.db, {
          ...actor,
          action: 'ai.member_update',
          meta: { enabled: body.enabled, role: 'sales' },
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
        const known = provider.knownModels?.() ?? CHATGPT_MODELS;
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
      if (!member()) throw errors.conflict('Add the Sales Agent before uploading documents');
      ctx.db.transaction(() => {
        const total = ctx.db
          .prepare(
            'SELECT count(*) AS count, coalesce(sum(length(text)), 0) AS characters FROM ai_documents',
          )
          .get() as { count: number; characters: number };
        if (
          total.count >= AI_DOCUMENT_LIMIT ||
          total.characters + text.length > AI_KNOWLEDGE_CHARACTERS
        )
          throw errors.validation(
            'Business knowledge can contain up to 20 documents and 500,000 characters',
          );
        const result = ctx.db
          .prepare('INSERT INTO ai_documents(name, size, text, created_at) VALUES (?, ?, ?, ?)')
          .run(name, size, text, Date.now());
        audit(ctx.db, {
          ...actor,
          action: 'ai.document_add',
          meta: { documentId: Number(result.lastInsertRowid), size },
        });
      })();
      cancelAll();
      refreshPending();
      return service.status();
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
      const knowledge = relevantKnowledge(
        knowledgeSources(body.knowledge, documentsText()),
        body.question,
      );
      // Same rule as live replies: with no relevant knowledge the AI hands the chat to a human.
      if (!knowledge.trim())
        return { ok: true, reply: HANDOFF_REPLY, action: 'handoff', model: null, error: null };
      let model: string | null = null;
      try {
        model =
          current.mode === 'api'
            ? current.model || OPENAI_DEFAULT_MODEL
            : ((await provider.resolveModel?.(current.model)) ?? current.model);
        const decision = await provider.generate(
          { ...current, ...body.knowledge },
          ctx.settings.getSecret(SECRET_KEY),
          buildAiPrompt(
            body.knowledge,
            knowledge,
            [{ speaker: 'customer', text: body.question }],
            false,
          ),
          AbortSignal.timeout(60_000),
        );
        return { ok: true, reply: decision.reply, action: decision.action, model, error: null };
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
