import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setMcpEnabled } from '../src/mcp/settings.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { data, mcpClient } from './mcp-helpers.js';

// The Reports counting fails: get_stats must still answer, only without its `customers` numbers.
vi.mock('../src/reports/report.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/reports/report.js')>()),
  cachedReport: () => {
    throw new Error('counting failed');
  },
}));

let t: TestApp;
const mcp = mcpClient(() => t);

beforeEach(async () => {
  t = await makeTestApp({ listen: true });
  setMcpEnabled(t.ctx, true);
});
afterEach(async () => {
  await t.close();
});

it('get_stats answers without the customer numbers when the report cannot be counted', async () => {
  const owner = t.ctx.services.auth!.createUser({
    username: 'owner',
    displayName: 'Owner',
    role: 'admin',
    password: 'password123',
    mustChangePassword: false,
  });
  const secret = t.ctx.services.apiTokens!.create(
    owner.id,
    { name: 'stats', expiresInDays: 90 },
    'ip',
  ).secret;
  const warn = vi.spyOn(t.ctx.log, 'child');

  const result = await mcp.call('get_stats', { days: 7 }, secret);

  expect(result.isError).toBeFalsy();
  const stats = data(result);
  expect(stats.chats).toEqual({ open: 0, resolved: 0 });
  expect(stats).not.toHaveProperty('customers');
  expect(warn).toHaveBeenCalledWith({ mod: 'mcp' });
});
