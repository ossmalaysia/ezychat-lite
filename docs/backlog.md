# Backlog (own follow-ups)

Our own open items. GitHub issues are for external reports only (AGENTS.md), so internal bugs and ideas
are listed here until they get a branch. Newest first; remove an item when its PR merges.

## Bugs

- **Emoji reactions: receive and show done** (branch `feat/emoji-reactions`, 2026-10-23; design
  `docs/features/emoji-reactions/design.md`). Left: (1) a live smoke against real WhatsApp of the Baileys
  mapping (`mapWAReaction`, `mapStoredReactions`: live, change, removal, group, history), still
  **untested against real WhatsApp**; (2) **let the team react** from EzyChat (send a `react` message,
  mock first); (3) optionally show "reacted 👍 to …" in the chat list preview.
- **Flag emoji show as letters on Windows** (2026-10-22): Chrome on Windows shows 🇲🇾 as "MY" (Windows has
  no flag glyphs). Fix with a bundled country-flag font (polyfill) for the web app.

## Ideas and next steps

- **Booking reminders** (2026-10-26, owner asked how; not in the first Google Calendar round): part of the
  Google Calendar connector, per agent: on/off, 1 day / 3 h / 1 h before, editable text; only bookings EzyChat
  made, re-read the event before sending (deleted → none, moved → new time), one per booking, not 10 pm–8 am;
  Business API inboxes need an approved template. Later a general "skills" layer can reuse the scheduled send.
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
