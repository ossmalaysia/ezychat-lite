# Backlog (own follow-ups)

Our own open items. GitHub issues are for external reports only (AGENTS.md), so internal bugs and ideas
are listed here until they get a branch. Newest first; remove an item when its PR merges.

## Bugs

- **Remote Google sign-in and file picker (Option B, assessed 2026-11-15, not built).** Fix A (PR
  `fix/picker-remote-device`) shows a notice instead of opening `127.0.0.1` on a remote or LAN device. Could the
  picker itself run in the remote browser through the tunnel? Verdict: **not feasible as it stands; feasible later
  only for a named https tunnel**, and not worth it before a customer asks. Assessed from Google's documentation and
  our code, not tried against live Google. (1) **Picker API key**: it is a browser key restricted by HTTP referrer.
  Today it only ever sees `http://127.0.0.1:<port>`. A remote page would need each tunnel host in the referrer list:
  a named tunnel has one fixed host (add it), a Quick Tunnel gets a new `*.trycloudflare.com` host each start (would
  need a wildcard, which lets anyone use our key's quota), a LAN address is `http://<ip>`. (2) **OAuth client type**:
  "Desktop app" is not the blocker. We do not use Google Identity Services in the page: the server holds the PKCE
  loopback token and hands the page an access token. A Web client would only be needed if the page signed in itself.
  Sign-in still returns to 127.0.0.1, so a remote device cannot sign in either way. (3) **Token exposure**: the picker
  needs the access token (`drive.file`, about 1 hour) in the remote browser. Over the tunnel it is https and the
  caller is a signed-in admin, but the token would cross the internet and sit in a page on the tunnel origin; over
  the LAN it would be plain http (readable on the network, and `setOrigin`/secure-context checks fail). Today it never
  leaves the computer. (4) **CSP**: workable. The picker page has its own CSP (`PICKER_PAGE_CSP`: Google's script and
  frames only), so the app's CSP stays; the host-only routes would need a second, session-checked variant and a
  `setOrigin` of the tunnel host. What it would take: named https tunnel only (refuse Quick Tunnel and LAN), the
  tunnel host added to the key's referrers by the owner, picker routes that need an admin session, `Cache-Control:
no-store` and a token valid for the one request, a security review (AGENTS.md "Security review for network changes"),
  a real-Google check, and a design decision from the owner. About 2–3 days. Recommendation: keep Fix A; Sheets can
  still be created from a remote device, and picking is a one-time setup step on the computer that runs EzyChat.
  Sign-in has a second blocker: Google returns only to redirect addresses registered in advance, and the "Desktop
  app" client allows loopback only; tunnel hostnames differ per install (and Quick Tunnel's change), so none can be
  registered. Ways to make it work: (1) **a fixed Anchor-owned relay page** (e.g. `ezychat.ai/connect/google`) with a
  "Web application" OAuth client (one redirect URI, one JS origin for the Picker key): the remote browser signs in and
  picks there, then the page posts the result back to the install through its tunnel URL. Works from any device and
  from a Quick Tunnel; costs hosting and securing the page, the token passing through the visitor's browser on our
  page, a code exchange that needs a client secret kept on our side (never in the app), possibly a new Google
  verification (client and scopes change) and a security review; Enterprise first. (2) **EzyChat Cloud**: one fixed
  domain, so it works natively with no relay. (3) **Google's device flow** (enter a code on another device) covers
  sign-in for a limited list of scopes (`drive.file` is on it, the Calendar scope is not, to be checked in Google's
  docs) and never the Picker, so it does not solve this alone. Plan: build (1) only on customer demand.
- Windows updater after an antivirus block (seen 2026-11-05, Enterprise 0.1.25 → 0.1.26 with McAfee, twice): the
  rollback that emptied Program Files is fixed (`WINDOWS_START_INSTALLER`, `WINDOWS_RESTORE_OLD_APP` in
  `apps/desktop/src/updater/install.ts`). Still to do: show the blocked-installer result in the app's own language
  and do not offer the same version again for some days, and an owner decision on a delay before offering new
  releases (frequent releases are always new, low-reputation installers).
- **Emoji reactions: receive and show done** (branch `feat/emoji-reactions`, 2026-10-23; design
  `docs/features/emoji-reactions/design.md`). Left: (1) a live smoke against real WhatsApp of the Baileys
  mapping (`mapWAReaction`, `mapStoredReactions`: live, change, removal, group, history), still
  **untested against real WhatsApp**; (2) **let the team react** from EzyChat (send a `react` message,
  mock first); (3) optionally show "reacted 👍 to …" in the chat list preview.
- **A failed file upload cannot be sent again** (code review of PR #196, 2026-10-28; older than that PR): the
  failed bubble keeps the caption, but Retry does not resend a local upload and the tray is already empty.
  Keep failed files (with caption and quote) in the composer tray, or let Retry upload the kept `File`.
- **Desktop drag-out not checked in the real window** (PR #196): drag an image or document from a chat to the
  desktop or a folder in the installed app (Electron `DownloadURL` drag; no `will-download` handler, so the
  default save path or dialog applies). Hand check in the next test release.

## Ideas and next steps

- **MCP sends: recheck the holder after a long link download** (2026-11-26, independent review of #402, low):
  `send_image` / `send_file` / `send_video` check the holder rule before the tool runs (`mcp/server.ts` `stillValid`),
  but not again after `from.load()` downloads a link (up to 60 min). A member switched off, disabled or removed from
  the chat meanwhile still gets the file sent. Admin tokens have the same gap. Fix: call `stillValid()` and
  `targetChat()` again just before `messages.sendMedia` in `mcp/send.ts#sendAttachment`, with a test that revokes
  during a slow download.
- **MCP address shown to members while the switch is off** (2026-11-26, review of #402, information only):
  `GET /api/integrations/mcp` answers every signed-in member with `publicUrl` / `localUrl`. Members reach the app
  through these addresses anyway; decide whether to answer only while `mcp_members_enabled` is on.
- **Split the web app's main file** (2026-11-14): `assets/index-*.js` is 2.13 MB after the combined merge and passed
  the PWA precache default (2 MiB, now raised to 3 MiB in `apps/web/vite.config.ts`). Load the admin area
  (`AdminLayout` and its pages) with `React.lazy` so agents and phones download less.
- **A permanent home for the living design-system page** (2026-11-14): `/design-system` lived only in the
  mobile-redesign mock, which the five-folder rule archived. Move it out of `docs/features/` (e.g. `docs/design-system/` or
  the app behind a dev flag) so pruning a feature folder never removes it.
- **jsdom 31** (2026-11-14, held back from Dependabot #369 in the combined merge): with jsdom 31 the web tests of
  dialogs that close (AiMemberPage templates, InboxesPage, MembersPage, PartnerConnectorPage, ReplyWindow; 18 tests)
  still find the dialog. Find what jsdom 31 changed (dialog/close or focus handling) before taking it; jsdom stays 30.
- **MCP `send_audio` / voice note** (2026-11-08, from `feat/mcp-file-upload`): uploads take JPEG/PNG/WebP/PDF/.docx/MP4
  only. An audio tool would need the Ogg/Opus checks of `messages/voice-note.ts` for a voice note, or a plain audio
  file type list; and more document types for `send_file` (xlsx, pptx) if the owner wants them.

- **Real-model check of the hand-off rules fixes** (PR #230, merged 2026-10-30): after the next release, run
  `try_ai_reply` on the Anchor Sprint agent (v87) with "Hi Anchor Sprint, I'd like to book a free consultation (from
  your homepage)." (expect action `answer` with a discovery question, no hand-off) and "What is the difference
  between Claude Team Standard and Premium seat?" (expect no check-in line). Needs the owner's AI sign-in; log the
  result in `docs/dev-build-checks.md`.
- **Idle AI chats** (2026-10-30, from PR #230): with "Ask if the question is answered" off (the default), an AI agent
  keeps a chat open and assigned to itself until a hand-off or a teammate acts, so answered chats pile up in the
  open list. Proposal: resolve a chat the AI holds after N days (e.g. 3) without a customer message, silently (no
  message to the customer; a new message reopens it as today), per-agent setting, audited. Mock first.

- **Waiting after AI hand-off in the inbox** (2026-10-30, from the hand-off rules fix): the count lives only in
  Reports and MCP `get_stats`; the push now says "<name> is waiting for a teammate". Add an inbox filter or badge
  for these chats (mock first, `docs/features/<feature>/mock`).

- **Ask Ezy: model choice** (owner, 2026-10-30, follow-up of 0.1.64): Ask Ezy answers on the connection's fast
  model. Add "Model for Ask Ezy" in Settings → AI (Fast default / same as the AI agent / a model of the
  connection), reusing the reply-suggestions model setting and route pattern.
- **Ask Ezy: follow-ups** listed in `docs/features/ask-ezy/design.md` (after round 9), plus a hand-off answer that
  shows real hand-off counts, not only the rules. (Screenshots: `docs/screenshots/ask-ezy/`, #222.)
- **AI reactions** (owner, 2026-10-30): let the AI add an emoji reaction where the connection supports reactions
  (linked phone), and reply with the emoji where it does not; needs a `reactions` capability on `WaAdapter`.
  The first use, a 👍 when a customer only thanks after the AI resolved the chat, is on `fix/ai-thanks-after-resolve`.
- **Booking reminders** (2026-10-26, owner asked how; not in the first Google Calendar round): part of the
  Google Calendar connector, per agent: on/off, 1 day / 3 h / 1 h before, editable text; only bookings EzyChat
  made, re-read the event before sending (deleted → none, moved → new time), one per booking, not 10 pm–8 am;
  Business API inboxes need an approved template. Later a general "skills" layer can reuse the scheduled send.
- **Google app verification** (2026-10-26): project `ezychat-prod` is in production with verified branding;
  data access (sensitive `calendar.events.owned`) needs the demo video and submission in the Verification Center.
  Until then users see Google's unverified-app screen (100-user cap). Release bundles carry the client since this PR.
- **Connector gallery: Enterprise custom connector tile** (2026-10-26): Enterprise registers its custom MCP
  connector page for the core gallery tile (web extension `connectorLinks`) and drops its own Connectors nav item.
- **Docs-only CI fast path** (2026-10-24): `main` requires the three `Test (*)` checks, so a doc PR cannot
  use `[skip ci]`. Add a first step in `ci.yml` that detects a change of `*.md` files only and reports the
  test jobs as passed without installing or testing.
- **Desktop memory** (measured 2026-10-24 on 0.1.51, temp data, fake WhatsApp, private MB): server ~230,
  shell without a window ~105, window open adds ~85 (renderer) and GPU grows from 60 to 130–260 and keeps
  it after the window closes. Next: (1) `app.disableHardwareAcceleration()` (GPU 205 → 21 in the probe;
  screen check for scrolling), (2) destroy the window on close instead of hiding it (renderer ~70–90 MB;
  reopen took 180–300 ms; tray and notifications must still work). Re-measure with real WhatsApp.

- **One affiliate download link** `https://ezychat.ai/download?ref=<code>` (website repo): detects
  Windows / Mac Apple silicon / Mac Intel and starts the newest published installer, buttons for the
  others. Waiting for the owner: skip or keep the download form for this link.
- **Enterprise 0.1.5 on core 0.1.48**: pins to 0.1.48; the connectors test double needs
  `GET /api/ai/agents` and `GET /api/ai/agents/1`; the Connectors card should read `useAgentSection()`
  to name the agent of the page; create `D:\dev\test-env\enterprise` (copy the earlier trial data).
- **AI agents follow-ups**: see `docs/features/custom-agents/design.md` → Follow-ups (copy items between
  agents, conflict warning, Try it as a short chat, and more).
- **Claude provider follow-ups**: test a saved Claude key from the page; wording for a Claude refusal.

## Final merge check follow-ups (release review)

- CI does not run the browser e2e (`npm run e2e`); the e2e points still come from a workbook stage. Running the
  e2e in CI would let the release review read it from the head like the link check (needs the owner's call:
  CI minutes, flaky-test policy).
