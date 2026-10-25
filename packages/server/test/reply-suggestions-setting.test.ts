import { afterEach, describe, expect, it } from 'vitest';
import {
  replySuggestionsEnabled,
  replySuggestionsUpgraded,
  setReplySuggestions,
} from '../src/ai/reply-suggestions-setting.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

describe('reply suggestions setting', () => {
  it('is on and not upgraded on a new install', async () => {
    t = await makeTestApp();
    expect(replySuggestionsEnabled(t.ctx.settings)).toBe(true);
    expect(replySuggestionsUpgraded(t.ctx.settings)).toBe(false);
  });

  it('saves the switch and audits the change without other data', async () => {
    t = await makeTestApp();
    setReplySuggestions(t.ctx, false, { userId: null, ip: '127.0.0.1' });
    expect(replySuggestionsEnabled(t.ctx.settings)).toBe(false);
    const rows = t.ctx.db
      .prepare("SELECT action, meta FROM audit_log WHERE action = 'ai.reply_suggestions.update'")
      .all() as Array<{ action: string; meta: string }>;
    expect(rows.map((r) => JSON.parse(r.meta))).toEqual([{ before: true, after: false }]);
  });

  it('does not audit a save that changes nothing', async () => {
    t = await makeTestApp();
    setReplySuggestions(t.ctx, true, { userId: null, ip: null });
    const count = t.ctx.db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ai.reply_suggestions.update'")
      .get() as { n: number };
    expect(count.n).toBe(0);
  });
});
