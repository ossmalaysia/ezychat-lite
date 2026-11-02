// send_file through the real /mcp route (real tokens, message service, send queue, fake WhatsApp),
// the port with an injected file download, and the guarded download against a local https server.
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@ezychat/shared';
import { MCP_SEND_MAX_FILE_BYTES } from '@ezychat/shared';
import { generateSelfSignedCert } from '../../../e2e/partner-mcp/cert.mjs';
import {
  createInboxSendPort,
  decodeFileBase64,
  guardedFileFetcher,
  sendClientId,
  SendError,
} from '../src/mcp/send.js';
import { getApiTokens } from '../src/api-tokens/index.js';
import { ZipArchive } from 'archiver';
import { pdfFixture } from './ai-fixtures.js';
import { makeTestApp, type TestApp } from './helpers.js';
import { data, mcpClient, rpc, waitFor, sendTokens } from './mcp-helpers.js';
import { makeZip } from './safety-helpers.js';

const LID = '9102@lid';
const PN = '60123450001@s.whatsapp.net';
const PDF = pdfFixture('Quotation 1042: 2 bags of house blend, RM136');
const PDF_B64 = PDF.toString('base64');
let DOCX: Buffer;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A Word file as Word writes it: the content types name the main document part. */
function docxFixture(text: string): Promise<Buffer> {
  const zip = new ZipArchive({ zlib: { level: 1 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.on('end', () => resolve(Buffer.concat(chunks)));
    zip.on('error', reject);
  });
  zip.append(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/></Types>`,
    { name: '[Content_Types].xml' },
  );
  zip.append(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    { name: 'word/document.xml' },
  );
  void zip.finalize();
  return done;
}

let t: TestApp;
let admin: User;
let readOnly: string;
let sender: string;
let senderId: number;

const mcp = mcpClient(() => t);
const { post, count } = mcp;
const call = (name: string, args: Record<string, unknown>, token = sender) =>
  mcp.call(name, args, token);

let n = 0;
const requestId = () => `file-test-${++n}-abcdef`;

beforeAll(async () => {
  DOCX = await docxFixture('Terms and conditions');
  t = await makeTestApp({ listen: true });
  ({ admin, readOnly, sender, senderId } = sendTokens(t));
  t.wa.simulateIncoming({
    chatJid: LID,
    chatJidAlt: PN,
    body: 'Send the quote',
    senderName: 'Aina',
  });
  await waitFor(() => count('SELECT COUNT(*) AS n FROM messages') === 1);
});
afterAll(async () => {
  await t.close();
});

const row = (id: string) =>
  t.ctx.db
    .prepare(
      `SELECT chat_jid, type, body, media_mime, media_name, sent_by_user_id, sent_via_token_id
       FROM messages WHERE client_id = ?`,
    )
    .get(sendClientId(senderId, id)) as Record<string, unknown> | undefined;

describe('send_file over /mcp', () => {
  it('is listed only for a token that can send, and is not read-only', async () => {
    const tools = async (token: string) =>
      (await post(rpc('tools/list'), token)).json().result.tools as Array<{
        name: string;
        annotations: Record<string, boolean>;
      }>;
    expect((await tools(readOnly)).map((x) => x.name)).not.toContain('send_file');
    const tool = (await tools(sender)).find((x) => x.name === 'send_file');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    const r = await call(
      'send_file',
      { jid: LID, fileBase64: PDF_B64, fileName: 'q.pdf', requestId: requestId() },
      readOnly,
    );
    expect(r.isError).toBe(true);
  });

  it('sends a PDF as a document with its name and caption, as the token owner, and audits it', async () => {
    const id = requestId();
    const r = await call('send_file', {
      jid: PN,
      fileBase64: `data:application/pdf;base64,${PDF_B64}`,
      fileName: 'Quotation-1042.doc',
      caption: 'Your quotation',
      requestId: id,
    });
    expect(r.isError).toBeUndefined();
    expect(data(r)).toMatchObject({ chatJid: LID, duplicate: false });
    // The extension comes from the real type, never the one passed.
    expect(row(id)).toEqual({
      chat_jid: LID,
      type: 'document',
      body: 'Your quotation',
      media_mime: 'application/pdf',
      media_name: 'Quotation-1042.pdf',
      sent_by_user_id: admin.id,
      sent_via_token_id: senderId,
    });
    await waitFor(() => t.wa.sent.some((m) => m.file?.caption === 'Your quotation'));
    const audit = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'mcp.send' ORDER BY id DESC LIMIT 1")
      .get() as { meta: string };
    expect(JSON.parse(audit.meta)).toMatchObject({
      tokenId: senderId,
      chatJid: LID,
      type: 'document',
    });
    expect(audit.meta).not.toContain('quotation');
  });

  it('sends a Word .docx file', async () => {
    const id = requestId();
    const r = await call('send_file', {
      jid: LID,
      fileBase64: DOCX.toString('base64'),
      fileName: 'Terms',
      requestId: id,
    });
    expect(r.isError).toBeUndefined();
    expect(row(id)).toMatchObject({
      type: 'document',
      media_mime: DOCX_MIME,
      media_name: 'Terms.docx',
      body: null,
    });
  });

  it('refuses anything that is not a PDF or .docx, whatever its name', async () => {
    const before = count('SELECT COUNT(*) AS n FROM messages');
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    for (const b64 of [
      png,
      makeZip([{ name: 'invoice.exe' }]).toString('base64'),
      Buffer.from('just some text').toString('base64'),
    ]) {
      const r = await call('send_file', {
        jid: LID,
        fileBase64: b64,
        fileName: 'invoice.pdf',
        requestId: requestId(),
      });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/Only PDF or Word \(\.docx\)/);
    }
    expect(count('SELECT COUNT(*) AS n FROM messages')).toBe(before);
  });

  it('a repeated requestId sends nothing again; an image requestId is a different message', async () => {
    const id = requestId();
    const args = {
      jid: LID,
      fileBase64: PDF_B64,
      fileName: 'a.pdf',
      caption: 'Twice',
      requestId: id,
    };
    const first = data(await call('send_file', args));
    const again = data(await call('send_file', args));
    expect(again).toMatchObject({ messageId: first.messageId, duplicate: true });
    expect(count('SELECT COUNT(*) AS n FROM messages WHERE body = ?', 'Twice')).toBe(1);
    const imgId = requestId();
    await call('send_image', {
      jid: LID,
      imageBase64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      requestId: imgId,
    });
    const mixed = await call('send_file', { ...args, caption: undefined, requestId: imgId });
    expect(mixed.content[0]!.text).toMatch(/already used/);
  });

  it('needs exactly one file source, a name, valid base64 and an existing chat', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ jid: LID, fileName: 'a.pdf' }, /fileUrl or fileBase64/],
      [
        { jid: LID, fileName: 'a.pdf', fileBase64: PDF_B64, fileUrl: 'https://example.com/a.pdf' },
        /fileUrl or fileBase64/,
      ],
      [{ jid: LID, fileBase64: PDF_B64 }, /fileName/],
      [{ jid: LID, fileName: 'a.pdf', fileBase64: '***not base64***' }, /fileBase64 is not valid/],
      [
        { jid: '60999999999@s.whatsapp.net', fileName: 'a.pdf', fileBase64: PDF_B64 },
        /Only existing chats/,
      ],
    ];
    for (const [args, message] of cases) {
      const r = await call('send_file', { ...args, requestId: requestId() });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(message);
    }
  });
});

describe('the send port with a file link', () => {
  it('downloads the link it was given and sends that file; a retry downloads nothing', async () => {
    const urls: string[] = [];
    const port = createInboxSendPort(t.ctx, {
      fetchFile: async (url) => {
        urls.push(url);
        return PDF;
      },
    });
    const principal = getApiTokens(t.ctx).resolve(sender);
    if (!principal.ok) throw new Error('token');
    const id = requestId();
    const input = {
      jid: LID,
      fileUrl: 'https://cdn.example.com/q.pdf',
      fileName: 'Q',
      requestId: id,
    };
    expect((await port.sendFile(principal.principal, input)).duplicate).toBe(false);
    expect(row(id)).toMatchObject({ type: 'document', media_name: 'Q.pdf' });
    expect((await port.sendFile(principal.principal, input)).duplicate).toBe(true);
    expect(urls).toEqual(['https://cdn.example.com/q.pdf']);
  });

  it('an empty download is refused', async () => {
    const port = createInboxSendPort(t.ctx, { fetchFile: async () => Buffer.alloc(0) });
    const principal = getApiTokens(t.ctx).resolve(sender);
    if (!principal.ok) throw new Error('token');
    await expect(
      port.sendFile(principal.principal, {
        jid: LID,
        fileUrl: 'https://cdn.example.com/empty.pdf',
        fileName: 'empty.pdf',
        requestId: requestId(),
      }),
    ).rejects.toThrow(/The file is empty/);
  });
});

describe('decodeFileBase64', () => {
  it('reads plain base64 and a data: URL; refuses bad and too large input', () => {
    expect(decodeFileBase64(PDF_B64)).toEqual(PDF);
    expect(decodeFileBase64(`data:application/pdf;base64,${PDF_B64}`)).toEqual(PDF);
    expect(() => decodeFileBase64('')).toThrow(SendError);
    const tooBig = Buffer.alloc(MCP_SEND_MAX_FILE_BYTES + 3).toString('base64');
    expect(() => decodeFileBase64(tooBig)).toThrow(/file is larger than 5 MB/);
  });
});

describe('guardedFileFetcher', () => {
  let server: Server;
  let origin: string;
  let ca: string;

  beforeAll(async () => {
    const tls = generateSelfSignedCert();
    ca = tls.cert;
    server = createServer({ cert: tls.cert, key: tls.key }, (req, res) => {
      if (req.url === '/q.pdf')
        return void res.writeHead(200, { 'content-type': 'application/pdf' }).end(PDF);
      if (req.url === '/big') {
        res.writeHead(200);
        return void res.end(Buffer.alloc(MCP_SEND_MAX_FILE_BYTES + 1024));
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('downloads a file (loopback only allowed in tests)', async () => {
    const get = guardedFileFetcher({ allowLoopback: true, ca });
    expect(await get(`${origin}/q.pdf`)).toEqual(PDF);
    await expect(get(`${origin}/missing`)).rejects.toThrow(/file link answered 404/);
    await expect(get(`${origin}/big`)).rejects.toThrow(/file is larger than 5 MB/);
  });

  it('never reaches this computer, a private network or plain http', async () => {
    const get = guardedFileFetcher();
    await expect(get(`${origin}/q.pdf`)).rejects.toThrow(
      /file link must be a public internet address/,
    );
    await expect(get('https://10.0.0.5/a.pdf')).rejects.toThrow(/public internet address/);
    await expect(get('http://example.com/a.pdf')).rejects.toThrow(/https:\/\//);
    await expect(get('https://unreachable.invalid/a.pdf')).rejects.toThrow(
      /file could not be downloaded/,
    );
  });
});
