import { describe, expect, it } from 'vitest';
import { AI_FULL_CONTEXT_CHARACTERS } from '../knowledge.js';
import { AI_TOOL_OUTPUT_CHARACTERS, chatTools } from './tools.js';

const run = async (tools: ReturnType<typeof chatTools>, name: string, input: object) =>
  (tools[name] as { execute: (i: object, o: object) => Promise<unknown> }).execute(input, {
    toolCallId: 't',
    messages: [],
  });

describe('chatTools', () => {
  const small = [{ name: 'Hours', text: 'We open 9am to 6pm.' }];
  const big = [
    { name: 'Hours', text: 'We open 9am to 6pm.' },
    { name: 'Catalogue', text: `Widget ${'x'.repeat(AI_FULL_CONTEXT_CHARACTERS)}` },
  ];

  it('offers no tools when the knowledge fits the prompt and the whole chat is in it', () => {
    expect(Object.keys(chatTools({ knowledge: small }))).toEqual([]);
  });

  it('offers a knowledge search only when the knowledge is too big to send in full', async () => {
    const tools = chatTools({ knowledge: big });
    expect(Object.keys(tools)).toEqual(['search_business_context']);
    const found = String(await run(tools, 'search_business_context', { query: 'open hours' }));
    expect(found).toContain('9am to 6pm');
    expect(found.length).toBeLessThanOrEqual(AI_TOOL_OUTPUT_CHARACTERS + 40);
  });

  it('pages back through THIS chat only and reports each tool used', async () => {
    const pages: number[] = [];
    const used: string[] = [];
    const tools = chatTools({
      knowledge: small,
      olderMessages: (page) => {
        pages.push(page);
        return page === 1 ? [{ speaker: 'customer', text: 'My order number is 4521' }] : [];
      },
      onCall: (name) => used.push(name),
    });
    expect(Object.keys(tools)).toEqual(['get_older_messages']);
    expect(String(await run(tools, 'get_older_messages', { page: 1 }))).toContain('4521');
    expect(await run(tools, 'get_older_messages', { page: 2 })).toBe('No earlier messages.');
    expect(pages).toEqual([1, 2]);
    expect(used).toEqual(['get_older_messages', 'get_older_messages']);
  });

  it('never asks the model which chat, phone or person to read', () => {
    const tools = chatTools({ knowledge: big, olderMessages: () => [] });
    const schemas = JSON.stringify(
      Object.values(tools).map((t) => (t as { inputSchema: unknown }).inputSchema),
    );
    expect(schemas).not.toMatch(/chat|jid|phone|user|customer/i);
  });
});
