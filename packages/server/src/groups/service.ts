import type { GroupInfoResponse, GroupMember } from '@wa-team-inbox/shared';
import { normalizeContactJid, type WaGroupInfo, type WaGroupParticipant } from '@wa-team-inbox/wa';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { errors } from '../http/errors.js';
import { getAliases } from '../chats/aliases.js';
import { isFallbackName } from '../chats/service.js';
import { jidUser } from '../chats/repo.js';
import { getChats } from '../wa-bridge/index.js';

/** How long a member list read from WhatsApp is reused before reading it again. */
export const GROUP_INFO_TTL_MS = 5 * 60_000;
const ABOUT_TTL_MS = 30 * 60_000;
const MAX_CACHED_GROUPS = 50;
const MAX_CACHED_ABOUTS = 2000;

export interface GroupService {
  /** Members of a group chat, with names we already know and links to existing direct chats. */
  info(groupJid: string): Promise<GroupInfoResponse>;
  /** A member's WhatsApp About text (fetched on demand, cached). */
  about(groupJid: string, memberJid: string): Promise<string | null>;
  /** The JID to ask WhatsApp for a member's photo, after checking they are in the group. */
  /** Whose photo to fetch, and a cache key that changes when the number moves to another person. */
  photoTarget(groupJid: string, memberJid: string): Promise<{ jid: string; key: string }>;
  /** The direct chat with a member: the existing one, or a new empty chat. */
  startChat(
    groupJid: string,
    memberJid: string,
    actor: { userId: number; ip: string | null },
  ): Promise<string>;
  shutdown(): void;
}

interface Cached {
  /** epoch ms when the list was read */
  at: number;
  until: number;
  info: Promise<WaGroupInfo>;
}

function evictOldest<K, V>(map: Map<K, V>, max: number): void {
  while (map.size >= max) map.delete(map.keys().next().value as K);
}

export function createGroupService(ctx: AppContext, deps?: { now?: () => number }): GroupService {
  const now = deps?.now ?? Date.now;
  const log = ctx.log.child({ mod: 'groups' });
  const cache = new Map<string, Cached>();
  const abouts = new Map<string, { until: number; about: Promise<string | null> }>();
  const onChanged = ({ groupJid }: { groupJid: string }) => {
    if (cache.delete(groupJid)) log.debug({ groupJid }, 'group member list invalidated');
  };
  ctx.wa.on('groupChanged', onChanged);

  function requireGroupChat(groupJid: string): void {
    const chat = getChats(ctx).get(groupJid);
    if (!chat || chat.type !== 'group') throw errors.notFound('Group');
  }

  function raw(groupJid: string): Promise<WaGroupInfo> {
    let entry = cache.get(groupJid);
    if (!entry || entry.until <= now()) {
      evictOldest(cache, MAX_CACHED_GROUPS);
      const t0 = now();
      // The list is live WhatsApp evidence: learn its phone/WhatsApp ID pairs before anything looks
      // up a member's chat, so a recycled number routes to its current owner, not the old chat.
      const info = ctx.wa.getGroupInfo(groupJid).then((g) => {
        const pairs = g.participants.flatMap((p) =>
          p.phoneJid && p.lidJid
            ? [{ jid: p.phoneJid, alias: p.lidJid, source: 'lid-mapping' as const }]
            : [],
        );
        if (pairs.length) getChats(ctx).upsertContactAliases(pairs);
        return g;
      });
      entry = { at: t0, until: t0 + GROUP_INFO_TTL_MS, info };
      cache.set(groupJid, entry);
      info.then(
        (g) =>
          log.info(
            { groupJid, size: g.size, listed: g.participants.length, ms: now() - t0 },
            'group members read',
          ),
        (err: unknown) => {
          cache.delete(groupJid);
          log.warn({ err, groupJid }, 'group members unavailable');
        },
      );
    }
    return entry.info;
  }

  async function member(groupJid: string, memberJid: string): Promise<WaGroupParticipant> {
    requireGroupChat(groupJid);
    const want = normalizeContactJid(memberJid);
    if (!want) throw errors.notFound('Member');
    const g = await raw(groupJid);
    const p = g.participants.find(
      (x) => x.jid === want || x.phoneJid === want || x.lidJid === want,
    );
    if (!p) throw errors.notFound('Member');
    return p;
  }

  /** Names we already know, by JID: saved contact name first, then the WhatsApp profile name. */
  function contactNames(jids: string[]): Map<string, string> {
    const out = new Map<string, string>();
    const stmt = ctx.db.prepare(
      `SELECT jid, saved_name, push_name FROM contacts WHERE jid IN (SELECT value FROM json_each(?))`,
    );
    for (let i = 0; i < jids.length; i += 500) {
      const rows = stmt.all(JSON.stringify(jids.slice(i, i + 500))) as Array<{
        jid: string;
        saved_name: string | null;
        push_name: string | null;
      }>;
      for (const r of rows) {
        const name = r.saved_name?.trim() || r.push_name?.trim();
        if (name) out.set(r.jid, name);
      }
    }
    return out;
  }

  /** A member's direct chat; a chat shows its phone number as the name when it has no real name. */
  type MemberChat = { jid: string; name: string; phone: string | null };

  /** Cache key for one person: the WhatsApp ID survives a phone number moving to someone else. */
  function identityKey(p: WaGroupParticipant): string {
    return `${p.lidJid ?? ''}|${p.phoneJid ?? p.jid}`;
  }

  /**
   * The name we know for a member: a real chat name, then contact names (WhatsApp ID first). A number
   * shown as a chat name is not a name, and a re-pointed number's contact name is the old owner's.
   */
  function knownName(
    p: WaGroupParticipant,
    names: Map<string, string>,
    chat: MemberChat | null,
  ): string | null {
    const numbers = [p.phoneJid && jidUser(p.phoneJid), chat?.phone].filter(Boolean);
    if (chat && !isFallbackName(chat.name, chat.jid) && !numbers.includes(chat.name))
      return chat.name;
    const lidName = p.lidJid ? names.get(p.lidJid) : undefined;
    if (lidName) return lidName;
    if (p.phoneJid && !getAliases(ctx).movedAway(p.phoneJid)) return names.get(p.phoneJid) ?? null;
    return null;
  }

  /** The existing direct chat for a member (by phone number or WhatsApp ID), if any. */
  function existingChat(p: WaGroupParticipant): MemberChat | null {
    const chats = getChats(ctx);
    const aliases = getAliases(ctx);
    for (const j of [p.lidJid, p.phoneJid]) {
      if (!j) continue;
      const chat = chats.get(aliases.route(j));
      if (chat && chat.type === 'dm') return { jid: chat.jid, name: chat.name, phone: chat.phone };
    }
    return null;
  }

  function myJids(): Set<string> {
    const me = normalizeContactJid(ctx.wa.status.me?.jid);
    const out = new Set<string>();
    if (!me) return out;
    out.add(me);
    for (const a of getAliases(ctx).group(me)) out.add(a);
    return out;
  }

  const ROLE_ORDER: Record<GroupMember['role'], number> = { superadmin: 0, admin: 0, member: 1 };

  return {
    async info(groupJid) {
      requireGroupChat(groupJid);
      const g = await raw(groupJid);
      const names = contactNames(
        g.participants.flatMap((p) => [p.phoneJid, p.lidJid].filter((j): j is string => !!j)),
      );
      const mine = myJids();
      const members: GroupMember[] = g.participants.map((p) => {
        const chat = existingChat(p);
        const known = knownName(p, names, chat);
        return {
          jid: p.jid,
          // A hidden number the team already knows from its own chat with this person.
          phone: p.phoneJid ? jidUser(p.phoneJid) : (chat?.phone ?? null),
          lid: p.lidJid,
          name: known,
          username: p.username,
          role: p.role,
          isMe: [p.jid, p.phoneJid, p.lidJid].some((j) => !!j && mine.has(j)),
          chatJid: chat?.jid ?? null,
        };
      });
      members.sort(
        (a, b) =>
          Number(b.isMe) - Number(a.isMe) ||
          ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
          Number(!a.name) - Number(!b.name) ||
          (a.name ?? a.phone ?? a.lid ?? '').localeCompare(b.name ?? b.phone ?? b.lid ?? ''),
      );
      const owner = g.ownerJid
        ? (members.find(
            (m) =>
              m.jid === g.ownerJid ||
              m.lid === g.ownerJid ||
              (m.phone && `${m.phone}@s.whatsapp.net` === g.ownerJid),
          ) ?? null)
        : null;
      return {
        group: {
          jid: g.jid,
          name: g.name ?? getChats(ctx).get(groupJid)?.name ?? null,
          description: g.description,
          createdAt: g.createdAt,
          createdBy: g.ownerJid
            ? {
                jid: g.ownerJid,
                name: owner?.name ?? null,
                phone:
                  owner?.phone ??
                  (g.ownerJid.endsWith('@s.whatsapp.net') ? jidUser(g.ownerJid) : null),
              }
            : null,
          size: g.size,
          adminCount: members.filter((m) => m.role !== 'member').length,
        },
        members,
        fetchedAt: cache.get(groupJid)?.at ?? now(),
      };
    },

    async about(groupJid, memberJid) {
      const p = await member(groupJid, memberJid);
      const jid = p.phoneJid ?? p.lidJid ?? p.jid;
      const key = identityKey(p);
      // Offline reads come back empty: never cache that as "no About".
      if (ctx.wa.status.state !== 'open') throw errors.waUnavailable();
      let entry = abouts.get(key);
      if (!entry || entry.until <= now()) {
        evictOldest(abouts, MAX_CACHED_ABOUTS);
        // A failed lookup is dropped from the cache and answered as "unavailable", never as empty.
        const about = ctx.wa.getAbout(jid).catch(() => {
          if (abouts.get(key)?.about === about) abouts.delete(key);
          throw errors.waUnavailable('WhatsApp could not read this About right now');
        });
        entry = { until: now() + ABOUT_TTL_MS, about };
        abouts.set(key, entry);
      }
      return entry.about;
    },

    async photoTarget(groupJid, memberJid) {
      const p = await member(groupJid, memberJid);
      return { jid: p.phoneJid ?? p.lidJid ?? p.jid, key: identityKey(p) };
    },

    async startChat(groupJid, memberJid, actor) {
      const p = await member(groupJid, memberJid);
      const mine = myJids();
      if ([p.jid, p.phoneJid, p.lidJid].some((j) => !!j && mine.has(j))) {
        throw errors.validation('You cannot start a chat with your own number');
      }
      const existing = existingChat(p);
      if (existing) return existing.jid;
      // Chats are keyed by the WhatsApp ID once known (the pair was learned when the list was read).
      const target = p.lidJid ?? p.phoneJid ?? p.jid;
      const names = contactNames([p.phoneJid, p.lidJid].filter((j): j is string => !!j));
      const name = knownName(p, names, null);
      const chat = getChats(ctx).upsertFromWa({ jid: target, type: 'dm', name });
      audit(ctx.db, {
        userId: actor.userId,
        action: 'chat.start_from_group',
        ip: actor.ip,
        meta: { groupJid, chatJid: chat.jid },
      });
      log.info(
        { groupJid, chatJid: chat.jid, userId: actor.userId },
        'direct chat started from group',
      );
      return chat.jid;
    },

    shutdown() {
      ctx.wa.off('groupChanged', onChanged);
      cache.clear();
      abouts.clear();
    },
  };
}
