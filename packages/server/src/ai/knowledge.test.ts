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
