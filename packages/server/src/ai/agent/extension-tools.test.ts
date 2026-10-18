import { afterEach, expect, it, vi } from 'vitest';
import pino from 'pino';
import { z } from 'zod';
import { tool } from 'ai';
import { Bus } from '../../bus.js';
import type { AppContext } from '../../context.js';
import type { ServerExtension } from '../../extensions.js';
import { AGENT_TOOLS_SETUP_MS, extensionAgentTools } from './extension-tools.js';

const log = pino({ level: 'silent' });
const ctxWith = (extensions: ServerExtension[]) =>
  ({ extensions, bus: new Bus(), log }) as unknown as AppContext;
const input = () => ({
  agent: 'sales' as const,
  chatJid: null,
  signal: new AbortController().signal,
});

afterEach(() => {
  vi.useRealTimers();
});

it('skips an extension whose tools fail to load and keeps the others', async () => {
  const turn = await extensionAgentTools(
    ctxWith([
      {
        name: 'broken',
        agentTools: async () => {
          throw new Error('cannot connect');
        },
      },
      {
        name: 'fine',
        agentTools: async () => ({
          tools: { fine_tool: tool({ inputSchema: z.object({}), execute: async () => 'ok' }) },
        }),
      },
    ]),
    log,
    input(),
    { onFailure: () => {} },
  );
  expect(Object.keys(turn.tools)).toEqual(['fine_tool']);
});

it('leaves out an extension that is not ready in time and disposes it when it arrives', async () => {
  vi.useFakeTimers();
  const dispose = vi.fn(async () => {});
  let release!: () => void;
  const slow: ServerExtension = {
    name: 'slow',
    agentTools: () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            tools: { slow_tool: tool({ inputSchema: z.object({}), execute: async () => 'ok' }) },
            dispose,
          });
      }),
  };
  const pending = extensionAgentTools(ctxWith([slow]), log, input(), { onFailure: () => {} });
  await vi.advanceTimersByTimeAsync(AGENT_TOOLS_SETUP_MS);
  const turn = await pending;
  expect(Object.keys(turn.tools)).toEqual([]);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('labels a tool without info by its name and extension, and dedupes the look-up lines', async () => {
  const turn = await extensionAgentTools(
    ctxWith([
      {
        name: 'shop',
        agentTools: async () => ({
          tools: { find: tool({ inputSchema: z.object({}), execute: async () => 'ok' }) },
        }),
      },
    ]),
    log,
    input(),
    { onFailure: () => {} },
  );
  const execute = turn.tools.find!.execute as (i: object, o: object) => Promise<unknown>;
  await execute({}, { toolCallId: '1', messages: [] });
  await execute({}, { toolCallId: '2', messages: [] });
  expect(turn.used()).toEqual([{ title: 'find', sourceLabel: 'shop' }]);
  expect(turn.calls()).toHaveLength(2);
});

it('does not count a call that fails because the turn was cancelled', async () => {
  const controller = new AbortController();
  const onFailure = vi.fn();
  const turn = await extensionAgentTools(
    ctxWith([
      {
        name: 'shop',
        agentTools: async () => ({
          tools: {
            find: tool({
              inputSchema: z.object({}),
              execute: async (): Promise<string> => {
                controller.abort();
                throw new Error('aborted');
              },
            }),
          },
        }),
      },
    ]),
    log,
    { agent: 'sales', chatJid: null, signal: controller.signal },
    { onFailure },
  );
  const execute = turn.tools.find!.execute as (i: object, o: object) => Promise<unknown>;
  await expect(execute({}, { toolCallId: '1', messages: [] })).rejects.toThrow();
  expect(turn.failed()).toBe(false);
  expect(onFailure).not.toHaveBeenCalled();
});
