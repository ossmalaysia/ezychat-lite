import { join } from 'node:path';
import { readStoredLidMappings, type WaContactAlias } from '@wa-team-inbox/wa';
import { runBackupSync } from '../backup/backup.js';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { getAliases } from './aliases.js';
import { mergeChat } from './merge.js';

export interface IdentityMigrationDeps {
  now?: () => number;
  /** default: readStoredLidMappings(<data>/wa-auth) */
  readPairs?: (authDir: string) => WaContactAlias[];
  /** default: runBackupSync(dataDir, db, now, { label: 'premerge' }) */
  backup?: (dataDir: string, db: DB, now: Date) => string;
}

export interface IdentityMigrationSummary {
  /** pairs read from the Baileys auth store */
  storedPairs: number;
  /** pairs that were new or re-pointed */
  learned: number;
  pending: number;
  merged: number;
  rekeyed: number;
  /** pending pairs whose phone-number chat was already gone when its merge ran */
  skipped: number;
  failed: number;
  backup: string | null;
  /** 'idle' = nothing to merge (no backup); 'backup-failed' = chats stay separate until a later start */
  result: 'idle' | 'merged' | 'failed' | 'backup-failed';
}

/**
 * Startup identity migration (spec §8): the only place chats are merged. Runs synchronously from
 * initMessaging before the chat/message services (send-queue restore), the AI Sales Agent,
 * HTTP/socket listen and the WhatsApp connection. A no-op without a backup when nothing needs merging.
 * Each merge is its own transaction; the backup runs before any of them, outside a transaction.
 */
export function runIdentityMigration(
  ctx: AppContext,
  deps: IdentityMigrationDeps = {},
): IdentityMigrationSummary {
  const log = ctx.log.child({ mod: 'contacts' });
  const now = deps.now ?? Date.now;
  const aliases = getAliases(ctx);

  let pairs: WaContactAlias[] = [];
  try {
    pairs = (deps.readPairs ?? readStoredLidMappings)(join(ctx.config.dataDir, 'wa-auth'));
  } catch (err) {
    log.warn({ err }, 'stored WhatsApp ID mappings unreadable; using saved aliases only');
  }
  let learned = 0;
  for (const pair of pairs) {
    const o = aliases.learn(pair, 'keystore');
    if (o.kind === 'added' || o.kind === 'repointed') learned++;
  }

  const pending = aliases.pendingMerges();
  const summary: IdentityMigrationSummary = {
    storedPairs: pairs.length,
    learned,
    pending: pending.length,
    merged: 0,
    rekeyed: 0,
    skipped: 0,
    failed: 0,
    backup: null,
    result: 'idle',
  };
  if (!pending.length) {
    log.info(summary, 'identity migration: nothing to merge');
    return summary;
  }

  // One restore point before the first change; VACUUM INTO must run outside any transaction.
  const backup =
    deps.backup ?? ((dataDir, db, at) => runBackupSync(dataDir, db, at, { label: 'premerge' }));
  try {
    summary.backup = backup(ctx.config.dataDir, ctx.db, new Date(now()));
  } catch (err) {
    summary.result = 'backup-failed';
    log.error(
      { err, ...summary },
      'pre-merge backup failed; chats stay separate until a later start',
    );
    return summary;
  }

  for (const p of pending) {
    try {
      const r = mergeChat(ctx.db, p.from, p.to, { now: now() });
      if (!r) {
        summary.skipped++;
        continue;
      }
      summary.merged++;
      if (r.rekeyed) summary.rekeyed++;
      log.info(
        {
          from: r.from,
          to: r.to,
          rekeyed: r.rekeyed,
          ...r.moved,
          assigneeDropped: r.assigneeDropped,
        },
        'chats merged',
      );
    } catch (err) {
      summary.failed++;
      log.error({ err, from: p.from, to: p.to }, 'chat merge failed; chats stay separate');
    }
  }
  summary.result = summary.merged === 0 && summary.failed > 0 ? 'failed' : 'merged';
  log.info(summary, 'identity migration completed');
  return summary;
}
