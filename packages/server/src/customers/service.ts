import type {
  Chat,
  CustomerProfile,
  CustomerProfileBody,
  CustomerProfileResponse,
  Message,
  SenderProfile,
} from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { errors } from '../http/errors.js';
import { getChats } from '../wa-bridge/index.js';
import { CustomerRepo, PROFILE_FIELDS, type ProfileFields } from './repo.js';

export interface CustomerService {
  /** The direct chat's profile (empty when never saved). Throws 404 for a missing chat, 400 for a group. */
  profile(chatJid: string): CustomerProfileResponse;
  /** Replaces the whole profile; audits which fields changed (never values). No change, no write. */
  save(
    chatJid: string,
    body: CustomerProfileBody,
    actor: { userId: number; ip: string | null },
  ): CustomerProfileResponse;
  suggestTags(q?: string): string[];
  /** Group messages: sender JID → their direct chat's profile name (only when one is set). */
  senderProfiles(senderJids: string[]): Map<string, SenderProfile>;
  /** Attaches `senderProfile` to inbound group messages (one batched lookup); others unchanged. */
  withSenderProfiles(messages: Message[]): Message[];
}

declare module '../context.js' {
  interface Services {
    customers?: CustomerService;
  }
}

const EMPTY: CustomerProfile = {
  id: null,
  name: null,
  company: null,
  email: null,
  otherPhone: null,
  address: null,
  tags: [],
  updatedAt: null,
  updatedBy: null,
};

export function createCustomerService(ctx: AppContext): CustomerService {
  const repo = new CustomerRepo(ctx.db);
  const chats = () => getChats(ctx);

  function directChat(chatJid: string): Chat {
    const chat = chats().get(chatJid);
    if (!chat) throw errors.notFound('Chat');
    if (chat.type !== 'dm') throw errors.validation('Group chats have no customer profile');
    return chat;
  }

  const service: CustomerService = {
    profile(chatJid) {
      const chat = directChat(chatJid);
      return { profile: repo.get(chat.jid) ?? EMPTY, whatsappName: chat.whatsappName ?? null };
    },

    save(chatJid, body, actor) {
      const jid = directChat(chatJid).jid;
      const fields = Object.fromEntries(
        PROFILE_FIELDS.map((f) => [f, body[f].trim() || null]),
      ) as ProfileFields;
      // Compare and write in one synchronous transaction: nothing can interleave.
      const changed = ctx.db.transaction((): string[] => {
        const tags = repo.canonicalTags(body.tags, jid);
        const before = repo.get(jid) ?? EMPTY;
        const diff: string[] = PROFILE_FIELDS.filter((f) => before[f] !== fields[f]);
        if (before.tags.join('\u001f') !== tags.join('\u001f')) diff.push('tags');
        if (!diff.length) return diff;
        repo.save(jid, fields, tags, actor.userId, Date.now());
        // Which fields changed, never their values (personal data).
        audit(ctx.db, {
          userId: actor.userId,
          action: 'customer.profile_update',
          ip: actor.ip,
          meta: { chatJid: jid, changed: diff },
        });
        return diff;
      })();
      if (changed.length) {
        const chat = chats().get(jid);
        if (chat) ctx.bus.emit('chat:updated', chat);
      }
      return service.profile(jid);
    },

    suggestTags(q) {
      return repo.suggest(q);
    },

    senderProfiles(senderJids) {
      const aliases = ctx.services.aliases;
      const byChat = new Map<string, string[]>();
      for (const sender of new Set(senderJids)) {
        const chatJid = aliases ? aliases.route(sender) : sender;
        byChat.set(chatJid, [...(byChat.get(chatJid) ?? []), sender]);
      }
      const names = repo.namesByChat([...byChat.keys()]);
      const out = new Map<string, SenderProfile>();
      for (const [chatJid, name] of names)
        for (const sender of byChat.get(chatJid) ?? []) out.set(sender, { chatJid, name });
      return out;
    },

    withSenderProfiles(messages) {
      const inGroup = (m: Message) => !m.fromMe && !!m.senderJid && m.chatJid.endsWith('@g.us');
      const senders = messages.filter(inGroup).map((m) => m.senderJid!);
      if (!senders.length) return messages;
      const profiles = service.senderProfiles(senders);
      return messages.map((m) =>
        inGroup(m) ? { ...m, senderProfile: profiles.get(m.senderJid!) ?? null } : m,
      );
    },
  };
  return service;
}

export function initCustomers(ctx: AppContext): void {
  ctx.services.customers = createCustomerService(ctx);
}
