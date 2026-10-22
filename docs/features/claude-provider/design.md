# Claude API as an AI provider (Claude API key connection)

Full design (contract, server, prompt caching, errors, tests): `docs/superpowers/specs/2026-10-22-claude-provider-design.md`.
Plan: `docs/superpowers/plans/2026-10-22-claude-provider.md` (Task 2). Status: **mock confirmed (delegated
self-review, 2026-10-22)**; the owner delegated the mock review ("You review it yourself").

## Owner decisions (2026-10-22)

| Decision    | Choice                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Sign-in     | API key only (console.anthropic.com); no Claude account sign-in                                |
| Models      | 3 fixed models: Claude Sonnet 5.5 (default), Claude Opus 5.5, Claude Haiku 5.5                 |
| Voice notes | Local voice only with Claude: cloud transcription (OpenAI) is hidden and a short note says why |
| Mock review | Delegated: the agent reviews the mock itself                                                   |

My calls inside the mock (all easy to change):

- **Three option cards instead of the segmented control.** "ChatGPT [Recommended] · OpenAI API key · Claude
  API key" does not fit one segmented row at 360 px; the cards reuse the Voice messages pattern (radio card
  with a one-line hint: "Your ChatGPT account. Experimental." / "Your own key, billed by OpenAI." / "Your own
  key, billed by Anthropic."). The labels name the vendor ("OpenAI API key", no longer "API key").
- The model select always shows a model (Sonnet when nothing is chosen = the server's `''` default), with a
  one-line hint comparing the three.
- "Test connection" in Claude mode appears once a key is saved (as for ChatGPT), and needs saving first.
- **Wrong-vendor key pointer** (optional for the builder): a `sk-ant-` key in the OpenAI field, or an OpenAI
  `sk-` key in the Anthropic field, gets "This is a Claude (Anthropic) key. Choose "Claude API key" …" /
  "This is an OpenAI key. …" instead of a generic rejection. Production can do this from the prefix before
  the key test; without it, the vendor's 401 gives the normal rejection.
- Unreachable Anthropic during the key test: a warning banner ("Could not reach Anthropic to check the key.
  You can still save it."), saving stays possible (spec: only a 401 blocks saving).
- Voice messages under Claude: the Cloud card is hidden, the grid becomes two columns, the note shows; when
  Cloud was the saved choice a warning asks for On this PC or Off; the privacy line drops the Cloud sentence.
- The agent page's connection line says "Connection: Anthropic API key is saved."

## Source baseline

- Feature **custom-agents**, path `docs/features/custom-agents/mock/`, as on `main` at
  `117d57e23e8817db156efa1301c4aa4accc92f06` (release 0.1.48). `latestConfirmed` in `mock-index.json` is
  revision `dc28d1d`; `117d57e` carries that confirmed mock plus the merged follow-up of PR #140
  (`MembersPage.tsx` and the three `admin.json` catalogs). Cloned whole with `git archive 117d57e`, not the
  working tree. The inherited custom-agents screenshots were not copied (they stay in the custom-agents folder).
- `reference.json` records the deltas: `snapshot.mjs --check` verifies the 150 frozen app files, 28 inherited
  files of earlier proposals (now including the custom-agents screens and mock stores) and the added files.

Reused screens and behaviour: Settings → AI (`AiConnectionSection.tsx`: saved-key note + Replace / Keep saved
key, Test key before save, the ready card, Save bar, Test connection), the inline connect card
(`AiQuickConnect.tsx`, used by the agent page and the setup wizard's AI assistant step: test-and-save in one
click, "Use … instead" links), Voice messages (`AiVoiceSection.tsx`: option cards) and the agent page
connection line (`AgentPage.tsx`).

## Mock

- Run: `npx tsx --conditions=ezychat-source docs/features/claude-provider/mock/run.ts --fake-wa`, then
  `http://localhost:7493/` (API `7492`). Walkthrough and checks: `mock/README.md`.
- Mock-only state: `src/mock/claude.ts` (localStorage `mock.claudeProvider.v1`: Claude active, key saved,
  model, stand-in flag). Production keeps the mode `claude`, the encrypted `ai_claude_api_key` and the model
  on the server (spec).
- Server mirror: while Claude is the saved connection, the mock server stays on its OpenAI-key connection so
  the agents can be turned on and tried (Try it is deterministic; nothing calls a model). With no OpenAI key
  saved, the mock stores a stand-in key and the OpenAI option keeps saying "no key" until a real one is
  entered (going back to OpenAI then asks for the key).
- Key test: `POST /api/mock/ai/test-claude-key` (`proposal.ts`): `sk-ant-` + 6 characters passes; a key with
  `offline` passes with the warning; an OpenAI `sk-` key and anything else are rejected.
- Screenshots: `node docs/features/claude-provider/mock/claude-shots.mjs` (desktop 1280 px, mobile 360 px)
  into `mock/screenshots/` (13 states × 2).

## Screen and state checklist

| Area             | Screen / state                                                                                                                                                                                                          | Mock |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Settings → AI    | Three connection options; description names ChatGPT, an OpenAI API key or a Claude API key (en, ms, zh-CN)                                                                                                              | yes  |
| Settings → AI    | Claude, no key yet: Anthropic API key field (password, `sk-ant-…`), hint, Test key, console link, model, voice note                                                                                                     | yes  |
| Settings → AI    | Key rejected (field error); OpenAI key in the Claude field (pointer); unreachable Anthropic (warning, save allowed)                                                                                                     | yes  |
| Settings → AI    | Save without a key: "Enter your Anthropic API key."; Save tests an untested key first                                                                                                                                   | yes  |
| Settings → AI    | Key saved: "Anthropic API key is saved." + Replace key / Keep saved key; Test connection "Claude Sonnet 5.5 replied: Hello!"                                                                                            | yes  |
| Settings → AI    | Model select: Claude Sonnet 5.5 (recommended), Claude Opus 5.5, Claude Haiku 5.5                                                                                                                                        | yes  |
| Settings → AI    | Switch Claude → OpenAI key → Claude: both keys stay saved, no retyping; ready card "The AI connection is ready."                                                                                                        | yes  |
| Settings → AI    | Switch Claude → ChatGPT sign-in: Claude stops being the connection, its key stays                                                                                                                                       | yes  |
| Connect card     | ChatGPT first, then "Use an OpenAI API key instead" and "Use a Claude API key instead"; in the Claude view: key, Test key (saves when it works), console link, voice note, links back                                   | yes  |
| Connect card     | Ready: "Claude API key checked and saved" (setup wizard; the agent page hides the card when ready)                                                                                                                      | yes  |
| Voice messages   | Claude: Cloud hidden, note; Cloud was on: warning; privacy line without the Cloud sentence                                                                                                                              | yes  |
| Agent page       | Connection line "Connection: Anthropic API key is saved."                                                                                                                                                               | yes  |
| Not in this mock | Real key checks, encrypted storage, Claude replies, error mapping (401/429/529/timeouts) and the 409 for cloud voice in `claude` mode (server, Task 1); translated texts of the new mock keys (Task 3 adds en/ms/zh-CN) | —    |

## Changed and added files (mock)

- Changed (frozen app files, now in `allowedDelta`): `src/admin/AiQuickConnect.tsx`, `src/admin/AiVoiceSection.tsx`.
- Changed again (already deltas): `src/admin/AiConnectionSection.tsx`, `src/admin/AgentPage.tsx` (connection
  line), `src/i18n/locales/{en,ms,zh-CN}/admin.json` (new `mockClaude.*` block, English in all three as the mock
  convention; the changed app key `ai.settingsDescription` is translated).
- Added: `src/mock/claude.ts`, `claude-shots.mjs`.
- Runner: `run.ts` (ports 7493/7492, temp-folder prefix, start message), `proposal.ts` (Claude key test, the
  Anthropic-key pointer in the OpenAI key test), `agent-shots.mjs` / `inbox-shots.mjs` (port and usage path),
  `README.md`, `reference.json`.

## Retention

Adding this sixth feature folder removed the oldest one, `docs/features/simple-first-setup` (clean and
committed; last revision with the folder `117d57e23e8817db156efa1301c4aa4accc92f06`, recorded in
`mock-index.json`).

## Confirmation

Delegated to the agent by the owner 2026-10-22 ("You review it yourself"). Self-review 2026-10-22, confirmed:

- Mock `tsc`: no error in the mock files (the only error is in `packages/server/src/ai/service.ts`, Task 1 work
  in progress: `hasClaudeApiKey` not yet returned). `snapshot.mjs --check` passes.
- `claude-shots.mjs` captured 13 states at 1280 px and 360 px with no page error and no horizontal overflow.
- Round 1 findings, fixed in the mock: the Test connection result named the model id (`claude-sonnet-5-5`) →
  now the product name; the Voice messages privacy line still said "With Cloud, the audio is sent to OpenAI"
  under Claude → Claude-specific line; phone shots of long cards were cut by the sticky Save bar (shot
  script only) → full-page phone shots.
- Reviewed after the fixes: option cards stack at 360 px with the Recommended badge on the same line; key
  field, warning banner and links wrap without clipping; the model list fits the phone width; the connect card
  reads ChatGPT first with the two key options below; touch targets are `size="touch"` (44 px).

`latestConfirmed` in `mock-index.json` is updated by the orchestrator after the commit (its `gitRevision` must
name the commit that holds this mock).

## Round 2 (2026-10-23): change the agent type on an existing agent

Owner: "do it now, and also allow role to be also support edit with AI". Lite has one agent that cannot be
deleted, and an upgraded install's agent is Sales, so the type chosen only on create could never change.
`AgentPage.tsx` gains an **Agent type** card on existing agents: **Change** opens the same Sales / FAQ /
Custom choice; unedited starting texts follow the new type, own texts stay (the card then offers "Use the
<type> template", with a confirm); **Edit role with AI** opens Edit with AI for the role outside the closed
Advanced section. The page header badge shows the type (no second badge in the card); the Role card's
template button stays only on the create page. Same change in `apps/web/src/admin/AiMemberPage.tsx`.
Review: delegated (owner: "You review it yourself"); mock tsc and `snapshot.mjs --check` pass.
