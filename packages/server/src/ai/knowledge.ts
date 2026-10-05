import { extname } from 'node:path';
import mammoth from 'mammoth';
import yauzl from 'yauzl';
import { getDocumentProxy } from 'unpdf';
import { errors } from '../http/errors.js';

export const AI_UPLOAD_BYTES = 10 * 1024 * 1024;
export const AI_DOCUMENT_CHARACTERS = 100_000;
export const AI_KNOWLEDGE_CHARACTERS = 500_000;
export const AI_DOCUMENT_LIMIT = 20;

/** Bound Word archive expansion before the document parser allocates its entries. */
function checkWordArchive(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(errors.validation('Invalid Word document'));
      let total = 0;
      let entries = 0;
      let hasDocument = false;
      zip.on('error', () => reject(errors.validation('Invalid Word document')));
      zip.on('entry', (entry: yauzl.Entry) => {
        total += entry.uncompressedSize;
        entries++;
        hasDocument ||= entry.fileName === 'word/document.xml';
        if (total > 20 * 1024 * 1024 || entries > 2000 || entry.generalPurposeBitFlag & 1) {
          zip.close();
          return reject(errors.validation('Word document is too large or encrypted'));
        }
        zip.readEntry();
      });
      zip.on('end', () =>
        hasDocument ? resolve() : reject(errors.validation('Invalid Word document')),
      );
      zip.readEntry();
    });
  });
}

export async function extractKnowledge(name: string, buffer: Buffer): Promise<string> {
  if (!buffer.length || buffer.length > AI_UPLOAD_BYTES)
    throw errors.validation('Upload a nonempty document up to 10 MB');
  const extension = extname(name).toLowerCase();
  let text: string;
  if (['.md', '.txt'].includes(extension)) {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw errors.validation('Text documents must use UTF-8 encoding');
    }
    if (text.includes('\0')) throw errors.validation('Invalid text document');
  } else if (extension === '.docx') {
    await checkWordArchive(buffer);
    try {
      text = (await mammoth.extractRawText({ buffer })).value;
    } catch {
      throw errors.validation('Cannot read this Word document');
    }
  } else if (extension === '.pdf') {
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw errors.validation('Invalid PDF document');
    try {
      const document = await getDocumentProxy(new Uint8Array(buffer), {
        useSystemFonts: false,
        disableFontFace: true,
      });
      try {
        if (document.numPages > 100)
          throw errors.validation('PDF documents can contain at most 100 pages');
        const pages: string[] = [];
        let characters = 0;
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
          characters += pageText.length;
          if (characters > AI_DOCUMENT_CHARACTERS)
            throw errors.validation('Document text exceeds 100,000 characters');
          pages.push(pageText);
          page.cleanup();
        }
        text = pages.join('\n\n');
      } finally {
        await document.loadingTask.destroy();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'HttpError') throw error;
      throw errors.validation(
        'Cannot read this PDF. Use an unencrypted PDF containing selectable text.',
      );
    }
  } else
    throw errors.validation('Upload a PDF, Word (.docx), Markdown (.md) or text (.txt) document');
  text = text.replace(/\r\n?/g, '\n').trim();
  if (!text)
    throw errors.validation('No readable text found. Scanned documents need OCR before upload.');
  if (text.length > AI_DOCUMENT_CHARACTERS)
    throw errors.validation('Document text exceeds 100,000 characters');
  return text;
}

/** Local retrieval: keep provider context bounded; no documents are hosted or executed. */
export function relevantKnowledge(
  sources: Array<{ name: string; text: string }>,
  query: string,
): string {
  const words = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(
    0,
    80,
  );
  const chunks = sources.flatMap((source) => {
    const result: Array<{ text: string; score: number; index: number }> = [];
    for (let offset = 0; offset < source.text.length; offset += 1200) {
      const text = source.text.slice(offset, offset + 1500);
      const lower = text.toLocaleLowerCase();
      const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
      result.push({ text: `[${source.name}]\n${text}`, score, index: result.length });
    }
    return result;
  });
  chunks.sort((a, b) => b.score - a.score || a.index - b.index);
  return chunks
    .slice(0, 14)
    .map((chunk) => chunk.text)
    .join('\n\n')
    .slice(0, 24_000);
}
