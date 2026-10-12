import type { Logger } from 'pino';
import type { Message } from '@wa-team-inbox/shared';
import { normalizeContactJid } from '@wa-team-inbox/wa';
import type { AppContext } from '../context.js';
import { getAliases } from '../chats/aliases.js';
import { isFallbackName } from '../chats/service.js';
import { jidUser } from '../chats/repo.js';
import type { MessageRow } from './repo.js';

// Whole numeric tags only. Emails, usernames and URLs are ordinary text.
const TAG = /(?<![\p{L}\p{N}_@])@(\d+)(?![\p{L}\p{N}_])/gu;
const URL = /(https?:\/\/[^\s<>]+)/g;

function textParts(body: string): string[] {
  return body.split(URL);
}

function tokens(body: string): string[] {
  return [
    ...new Set(
      textParts(body).flatMap((part, index) =>
        index % 2 ? [] : [...part.matchAll(TAG)].map((m) => m[1]!),
      ),
    ),
  ];
}

function storedMentions(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.flatMap((jid: unknown) => {
          const normalized = normalizeContactJid(jid);
          return normalized ? [normalized] : [];
        })
      : [];
  } catch {
    // Corrupt metadata must never turn ordinary text into a guessed mention.
    return [];
  }
}

interface KnownIdentity {
  jid: string;
  saved_name: string | null;
  push_name: string | null;
  chat_name: string | null;
  profile_name: string | null;
}

/**
 * Name mentions only in presentation. The original body remains in SQLite for sends and quotes.
 * New messages use explicit WhatsApp metadata. Old group messages can use an exact known identity
 * when their numeric tag is unambiguous across the phone and LID namespaces. No network lookups.
 */
export function createMentionPresenter(ctx: AppContext, log: Pick<Logger, 'debug'>) {
  const identities = ctx.db.prepare(`
    SELECT ids.value AS jid, c.saved_name, c.push_name, ch.name AS chat_name, p.name AS profile_name
    FROM json_each(?) ids
    LEFT JOIN contacts c ON c.jid = ids.value
    LEFT JOIN chats ch ON ch.jid = ids.value AND ch.type = 'dm'
    LEFT JOIN customer_profiles p ON p.chat_jid = ids.value
    WHERE c.jid IS NOT NULL OR ch.jid IS NOT NULL OR p.chat_jid IS NOT NULL
  `);

  return (rows: MessageRow[], messages: Message[]): Message[] => {
    const aliases = getAliases(ctx);
    const wanted = new Set<string>();
    const plans = rows.flatMap((row, index) => {
      if (!row.body || row.type === 'system') return [];
      const legacy = row.mentioned_jids == null;
      if (legacy && !row.chat_jid.endsWith('@g.us')) return [];
      const tags = tokens(row.body);
      if (!tags.length) return [];
      const byToken = new Map<string, Set<string>>();
      const add = (token: string, jid: string) => {
        const candidates = byToken.get(token) ?? new Set<string>();
        candidates.add(jid);
        byToken.set(token, candidates);
        for (const id of aliases.group(jid)) {
          if (!aliases.movedAway(id)) wanted.add(id);
        }
      };
      if (legacy) {
        for (const tag of tags) {
          add(tag, `${tag}@lid`);
          add(tag, `${tag}@s.whatsapp.net`);
        }
      } else {
        for (const jid of storedMentions(row.mentioned_jids!)) {
          if (aliases.movedAway(jid)) continue;
          // The body may use the person's phone digits while metadata uses their LID or vice versa.
          for (const id of aliases.group(jid)) {
            if (!aliases.movedAway(id) && tags.includes(jidUser(id))) add(jidUser(id), jid);
          }
        }
      }
      return [{ index, legacy, byToken }];
    });
    if (!plans.length) return messages;

    const known = new Map<string, KnownIdentity>();
    const ids = [...wanted];
    for (let i = 0; i < ids.length; i += 500) {
      for (const row of identities.all(JSON.stringify(ids.slice(i, i + 500))) as KnownIdentity[]) {
        known.set(row.jid, row);
      }
    }

    const nameFor = (jid: string): { identity: string; known: boolean; name: string | null } => {
      const identity = aliases.resolve(jid);
      // Stored phone contact/chat names may belong to the previous owner of a recycled number.
      if (aliases.movedAway(jid)) return { identity: jid, known: true, name: null };
      const group = aliases.group(jid).filter((id) => !aliases.movedAway(id));
      const records = group.flatMap((id) => (known.get(id) ? [known.get(id)!] : []));
      const meaningful = (name: string | null, id: string) =>
        name?.trim() && !isFallbackName(name.trim(), id) ? name.trim() : null;
      const best = (field: keyof Omit<KnownIdentity, 'jid'>) =>
        records.map((row) => meaningful(row[field], row.jid)).find(Boolean);
      return {
        identity,
        known: records.length > 0 || group.length > 1,
        name:
          best('profile_name') ||
          best('saved_name') ||
          best('chat_name') ||
          best('push_name') ||
          null,
      };
    };

    let resolvedMentionCount = 0;
    const out = [...messages];
    for (const plan of plans) {
      const replacements = new Map<string, string>();
      for (const [token, candidates] of plan.byToken) {
        const choices = new Map<string, string | null>();
        for (const jid of candidates) {
          const result = nameFor(jid);
          if (!plan.legacy || result.known) choices.set(result.identity, result.name);
        }
        if (choices.size === 1) {
          const name = [...choices.values()][0];
          if (name) replacements.set(token, name);
        }
      }
      const message = messages[plan.index]!;
      const body = textParts(message.body!)
        .map((part, index) =>
          index % 2
            ? part
            : part.replace(TAG, (tag, token: string) => {
                const name = replacements.get(token);
                if (!name) return tag;
                resolvedMentionCount++;
                return `@${name}`;
              }),
        )
        .join('');
      if (body !== message.body) out[plan.index] = { ...message, body };
    }
    log.debug(
      {
        messageCount: plans.length,
        legacyMessageCount: plans.filter((p) => p.legacy).length,
        resolvedMentionCount,
      },
      'message mention presentation',
    );
    return out;
  };
}
