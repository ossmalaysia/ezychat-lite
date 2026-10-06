import { expect, it } from 'vitest';
import { extractKnowledge, relevantKnowledge } from './knowledge.js';
import { extractKnowledgeIsolated } from './knowledge-worker.js';
import { pdfFixture, wordFixture } from '../../test/ai-fixtures.js';

it('extracts plain Markdown, selectable PDF and Word text without executing content', async () => {
  expect(await extractKnowledge('faq.md', Buffer.from('# Hours\r\n9am to 5pm'))).toBe(
    '# Hours\n9am to 5pm',
  );
  expect(await extractKnowledge('faq.pdf', pdfFixture('Open from 9am to 5pm'))).toContain(
    '9am to 5pm',
  );
  expect(await extractKnowledge('faq.docx', await wordFixture('Delivery costs RM10'))).toContain(
    'Delivery costs RM10',
  );
});

it('rejects malformed, empty, binary, unsupported, oversized and textless documents', async () => {
  for (const [name, buffer] of [
    ['empty.txt', Buffer.alloc(0)],
    ['binary.md', Buffer.from([0xff, 0x00])],
    ['bad.pdf', Buffer.from('not a PDF')],
    ['bad.docx', Buffer.from('not a zip')],
    ['legacy.doc', Buffer.from('legacy')],
    ['scan.pdf', pdfFixture('')],
    ['large.txt', Buffer.from('a'.repeat(100_001))],
    ['upload.txt', Buffer.alloc(10 * 1024 * 1024 + 1)],
  ] as Array<[string, Buffer]>)
    await expect(extractKnowledge(name, buffer)).rejects.toThrow();
});

it('runs actual PDF and Word parsers in the isolated worker and returns safe validation errors', async () => {
  expect(await extractKnowledgeIsolated('faq.pdf', pdfFixture('PDF business facts'))).toContain(
    'PDF business facts',
  );
  expect(
    await extractKnowledgeIsolated('faq.docx', await wordFixture('Word business facts')),
  ).toContain('Word business facts');
  await expect(extractKnowledgeIsolated('bad.pdf', Buffer.from('bad'))).rejects.toThrow(
    'Invalid PDF',
  );
}, 20_000);

it('retrieves the most relevant chunks from large knowledge sources within the prompt budget', () => {
  const sources = [
    { name: 'Unrelated', text: 'Office wall colour is white. '.repeat(4000) },
    { name: 'Delivery', text: 'Delivery costs RM10 in Malaysia.' },
  ];
  const selected = relevantKnowledge(sources, 'What does delivery cost in Malaysia?');
  expect(selected.startsWith('[Delivery]')).toBe(true);
  expect(selected.length).toBeLessThanOrEqual(24_000);
});

it('sends every knowledge source verbatim and in order when it fits the full-context budget', () => {
  const sources = [
    {
      name: 'Business context',
      text: 'Kedai Kopi Ezy sells coffee.\n\nWi-Fi is free for dine-in.',
    },
    { name: 'menu.pdf', text: 'Latte RM9' },
    { name: 'empty.md', text: '   ' },
    { name: 'hours.txt', text: 'Open 8am-10pm daily' },
  ];
  expect(relevantKnowledge(sources, '堂食有免费上网吗？')).toBe(
    '[Business context]\nKedai Kopi Ezy sells coffee.\n\nWi-Fi is free for dine-in.\n\n' +
      '[menu.pdf]\nLatte RM9\n\n[hours.txt]\nOpen 8am-10pm daily',
  );
  expect(relevantKnowledge([{ name: 'Business context', text: '' }], 'hi')).toBe('');
});

const filler = (count: number) =>
  Array.from({ length: count }, (_, i) => `Paragraph ${i}: the office wall colour is white.`).join(
    '\n\n',
  );

it('finds a Chinese fact deep in a large context by character bigrams', () => {
  const context = `${filler(1500)}\n\n堂食顾客可以免费使用无线上网。`;
  expect(context.length).toBeGreaterThan(40_000);
  const selected = relevantKnowledge(
    [{ name: 'Business context', text: context, pinFirst: true }],
    '堂食有免费上网吗？',
  );
  expect(selected).toContain('堂食顾客可以免费使用无线上网。');
  expect(selected.length).toBeLessThanOrEqual(24_000);
});

it('always includes the first context chunk (the overview) above the budget', () => {
  const context = `Ezy Bakery: we sell cakes and bread in Johor Bahru.\n\n${filler(1500)}`;
  const selected = relevantKnowledge(
    [
      { name: 'Business context', text: context, pinFirst: true },
      { name: 'delivery.md', text: 'Delivery costs RM10 in Malaysia.' },
    ],
    'What does delivery cost in Malaysia?',
  );
  expect(selected.startsWith('[Business context]\nEzy Bakery: we sell cakes')).toBe(true);
  expect(selected).toContain('[delivery.md]\nDelivery costs RM10 in Malaysia.');
});
