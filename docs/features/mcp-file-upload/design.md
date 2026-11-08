# MCP file upload (larger files for the send tools)

Owner request (Jazz, 2026-11-08, relayed by the master session `session_01J4pmGkCf1Mvdepudm8WQAd`): "allow larger file
size and allow binary or multi part". Until now `send_image` and `send_file` took at most 5 MB, as base64 inside the
JSON of one `/mcp` request or as a public https link.

No screen changes: Settings → AI assistant access is unchanged, so there is no mock (AGENTS.md mock rule applies to
features that require UI).

## What changes

| Piece                       | Before                      | After                                                                                      |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| Upload endpoint             | none                        | `POST /mcp/uploads`: raw body (`X-File-Name`) or `multipart/form-data` (one `file` part)   |
| `send_image` / `send_file`  | `…Url` or `…Base64`, 5 MB   | exactly one of `…Url`, `…Base64`, `uploadId`; links and uploads up to 100 MB               |
| `send_video` (new)          | none                        | MP4 by link, base64 or upload; `sendAs` video / file; over the number's video limit → file |
| Base64                      | 5 MB                        | still 5 MB (`MCP_SEND_MAX_BASE64_BYTES`): it travels inside the 8 MB `/mcp` JSON body      |
| Link downloads              | buffered, 5 MB, 10 s        | streamed to a private file, 100 MB, 2 min (`LONG_TRANSFER_TIMEOUT_MS`)                     |
| Message service `sendMedia` | buffer only                 | buffer or `path` (moved into the media store with `MediaStore.adopt`, never read whole)    |
| Audit `mcp.send`            | tokenId, chatJid, messageId | + `type` and `size` (still never name, caption or content)                                 |

`POST /mcp/uploads` answers `201 { uploadId, name, type, size, expiresAt }` (shared `McpUploadResponse`). An upload
belongs to the token that made it, is kept 1 hour (`MCP_UPLOAD_TTL_MS`) and can be sent once; a send moves its file
into the message (Forward's path-based send: Baileys `{ url }`, no buffer). A refused send (wrong type for the tool,
closed reply window, size above the number's limit) keeps the upload for another try.

```bash
# raw body
curl -H "Authorization: Bearer $TOKEN" -H "X-File-Name: quote.pdf" --data-binary @quote.pdf https://<host>/mcp/uploads
# multipart
curl -H "Authorization: Bearer $TOKEN" -F file=@demo.mp4 https://<host>/mcp/uploads
```

Sizes: the composer's 100 MB (`MCP_UPLOAD_MAX_BYTES = MEDIA_UPLOAD_LIMIT_BYTES`), then each target inbox's
`WaCapabilities.mediaLimits` in `sendMedia` with Forward's codes (`too_large_as_video`, `too_large_for_whatsapp`).
`send_video` without `sendAs` sends a video above the number's video limit as a file (linked phone: 64 MB; Business
API: 16 MB); `sendAs: 'video'` is refused with `too_large_as_video` instead.

Accepted types (read from the bytes, never the label, header or name): JPEG, PNG, WebP, PDF, Word .docx, MP4. Audio
is left out (backlog: an MCP voice note would need the Ogg/Opus checks of `voice-note.ts`).

## Kept rules

- Token scope `inbox:send` (a token with Can send), owner rechecked as an active admin by `tokens.resolve` on every
  call, including the upload.
- Idempotency per token + `requestId`: a retry is answered from the stored message before any upload, download or
  limit is touched; an upload already used gives "No upload … already sent" only to a **new** requestId.
- Send limits 10 a minute and 100 a day per token (an upload id that does not exist is refused before counting).
- Reply window (`window_closed`), removed inbox, moved number and quote checks: the message service's, unchanged.
- Safety: outbound files are not scanned (the composer's are not either); Safety inspects inbound messages only.
- Logs: `mcp upload` {tokenId, uploadId, type, size, ms}; `mcp upload expired` {tokenId, uploadId}. Never the file
  name, caption or content.

## Security review (owner rule "Security review for network changes")

**Interfaces touched.** No new listener, port, host binding or tunnel change: `POST /mcp/uploads` is a new route on the
existing server, inside the same Fastify scope as `POST /mcp`. Outbound: link downloads already existed (guarded
fetch); only their size and time limits grew.

**Who can reach it.** Exactly who can reach `/mcp`, enforced by the same `onRequest` hook, before any byte of the body
is read: AI assistant access off → 404; a LAN peer → 403 (only direct loopback or the Cloudflare tunnel, via
`isLocalOrTunnel`); a browser Origin that is not the Host → 403; per-IP limit (120 a minute) and failed-token limit;
invalid / expired / revoked token or an owner who is no longer an active admin → 401; per-token request limit (60 a
minute). A route-level `onRequest` then refuses a token without `inbox:send` (403) and a `Content-Length` above
100 MB + 64 KB (413), still before the body. The access gate (`createAccessHook`) and the Host allowlist apply as for
every `/mcp` path. No cookie is accepted, so a signed-in browser page cannot upload through CSRF.

**What the LAN or tunnel can reach.** LAN: nothing (403 before the body). Tunnel: a token holder can store at most the
limits below; they could already send 5 MB files. Cloudflare itself caps a request body at 100 MB on Free/Pro plans,
so a 100 MB file plus multipart framing may be refused at the edge; uploads on this computer have no edge limit.

**Body handling.** Only this route's child scope removes the JSON and text parsers and adds a pass-through parser for
every other type, so the body is never parsed or buffered by Fastify; multipart goes through `@fastify/multipart`'s
streaming `req.file()` (one file, 4 fields, 5 parts). The stream is piped through a byte counter into
`<data>/mcp-uploads/<random>.bin` (folder 0700, file 0600, `wx` so it never follows or overwrites a file); the counter
stops the stream above the limit and the partial file is deleted. Type check: `file-type` on the stored file; anything
else → 415 and deleted. The file name is cleaned (last path segment, control and bidi characters removed, 120
characters) and is only ever used as the WhatsApp document name; the stored path is random.

**DoS and disk exhaustion.** Per token: 30 uploads an hour (failed ones count), 2 GB received a day (failed and
refused bytes count), 10 uploads waiting, 2 receiving at once. In total: 4 receiving at once, 1 GB waiting, and an
upload or link download is refused (507 `upload_storage_full`) when it would leave less than 1 GB free on the data
disk (`statfs`). Fastify sets no request timeout, so the upload stream itself stops a sender after 60 s without data
or 30 minutes in total (408 `upload_timeout`, partial file deleted). A link download
is bounded by 100 MB, 2 minutes, the free-disk check and the send limits (10 a minute, 100 a day).

**Temp-file cleanup.** Sent: moved into the media store (rename, or copy + delete across disks). Refused send: kept until
it expires. Expired: deleted by a 5-minute sweep and on every new upload. Server start: the whole folder is deleted
(uploads never outlive a restart). Link downloads: deleted in `finally` unless the send moved them.

**Invariants.** MCP invariants in AGENTS.md updated (upload route, limits, `send_video`). CSP, cookies, session, setup,
Host/Origin checks, SSRF guard (`guardedFetch`: https only, public addresses checked on the connected address,
same-origin redirects) unchanged.

## Verification

- Unit/route tests: `packages/server/test/mcp-upload.test.ts` (reach and token order, raw and multipart, 415, 413
  declared and streamed, store limits, stalled sender, expiry and restart cleanup, `uploadId` sends, `send_video` as video / file /
  refused, link downloads to disk), plus the existing send_image / send_file suites.
- Dev Build check: `docs/dev-build-checks.md` (2026-11-08, curl against a `--fake-wa` server: 50 MB PDF raw,
  70 MB MP4 multipart, 100 MB streamed with ~10 MB server memory growth).
- Untested against real WhatsApp: no `packages/wa/src/baileys/**` change; the path-based send is Forward's (its
  linked-phone video limit is still the 64 MB placeholder until measured).
