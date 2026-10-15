# Simple first-time setup design

Status: owner-confirmed reference (2026-10-15, mock revision 90a95da); production implementation in progress.

## Reference and provenance

- [Interactive HTML app](mock/index.html), [run instructions and walkthrough](mock/README.md),
  [source manifest](mock/reference.json), [screenshots](mock/screenshots/).
- Cloned the latest owner-confirmed cumulative reference, **customer-enrichment**
  (`docs/features/customer-enrichment/mock/`), at Git revision
  `8716cb73ab86186aaacf202bcbbf00e256f52ecb` (`latestConfirmed` in [mock index](../mock-index.json);
  identical to that folder at the clone point). Its Customer enrichment Settings card and Audit score
  remain part of this reference unchanged.
- Current app at proposal time: EzyChat Lite **0.1.36**, `2ce7018`. The frozen frontend hashes still
  describe the 0.1.34 source (`643a724`) the baseline was built from; the runner uses the 0.1.36 server.
- The baseline's own screenshots were not copied (they remain in the customer-enrichment folder).

## Audit of the 0.1.36 first run (what this fixes)

About 25 clicks/fields over 7 screens before the AI answers a customer:

- Setup asks username + display name + password + confirm password.
- Step 3 is "Remote access" and talks about Cloudflare; the AI is never mentioned.
- The empty inbox gives no next step.
- The AI lives under Admin → Members → Add AI member; the Sales Agent page is blocked by
  "Connect the AI in Settings → AI first" and shows ~40 lines of instructions and hand-off rules up front.
- Settings → AI offers API key vs "ChatGPT Experimental"; no way back from Settings → AI to the Sales Agent.
- Bugs: clicking the ChatGPT option on its "Experimental" badge does not select it (the badge
  intercepts the pointer); a wrong API key is saved without any check.

## Owner decisions

- Main AI connection is **Sign in with ChatGPT** (first, "Recommended"); the OpenAI API key is the
  secondary option. Calm, honest note everywhere ChatGPT is offered: "Uses your ChatGPT account. This
  connection is unofficial and could stop working; you can switch to an API key at any time."
- Scope is **quick wins**, not a redesign. Existing screens, routes and components are extended.

## Scope (what the mock shows)

A. **Setup wizard**: Account → WhatsApp → AI assistant → Ready.

- Account: Business name (new), Your name, Username (filled in from Your name as lowercase
  `first.last`, editable), one Password field with show/hide (Confirm removed). Loopback-only rule,
  403 banner and validation messages kept.
- WhatsApp: unchanged QR / phone-number linking. Mock: QR first, then a dashed, clearly labelled
  "Demo: simulate scanning the code" button; the phone-number tab links 6 s after the code is shown.
  Skip now continues to the AI step instead of leaving setup.
- AI assistant (new, skippable): one sentence on what it does and that it hands chats to the team;
  "About your business" prefilled with `<business>` + Opening hours / Products & prices / Delivery /
  How to order; **Sign in with ChatGPT** (Recommended) with the note; "Use an OpenAI API key instead"
  reveals the key with **Test key** (a working key is saved immediately); "Turn on the AI assistant
  now" (on by default, shown once connected); **Finish** and **Skip for now**. Finish saves the Sales
  Agent ("<business> AI", recommended instructions and hand-off rules), the text as Business context
  item "About the business", then turns it on if chosen. Without a connection Finish still saves the
  text and leaves the AI off; an untouched template is refused with a clear message.
- Ready: "Your inbox is ready", WhatsApp linked / AI on-off summary, secondary Add teammates and
  "Use on phones outside this Wi-Fi" (/admin/tunnel), **Go to inbox**. No Cloudflare wording.
  B. **Getting started card** (admins only) on the inbox's no-chat-selected pane (desktop) and the empty
  chat list (phones): AI assistant (Set up), Teammates (Add), Phone access (Set up); finished items are
  hidden, the card disappears when all are done and × hides it (per browser).
  C. **Sales Agent page**: when not connected, an inline **Connect the AI** card (same component as the
  wizard) replaces "go to Settings"; the Turn on hint says "Connect the AI below first." AI instructions
  and Hand-off rules move into a closed "Advanced: instructions and hand-off rules" section whose
  summary says "Using recommended settings" or "Customised". Name, Business context, Try it and
  Turn on stay visible.
  D. **Settings → AI**: ChatGPT first with "Recommended" (new installs default to ChatGPT); the badge has
  `pointer-events-none` so a click anywhere on the option selects it; API key gets **Test key**, and
  Save tests a new key first (a failing key is not saved); "The AI connection is ready" row with
  **Set up the Sales Agent**; Voice messages and Customer enrichment collapse under "More AI features".
  E. Admin nav "Cloudflare" → **Phone access**, page heading too. Route stays `/admin/tunnel`.

## Existing feature references reused

| Source                                                                   | Reused / extended                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/setup/SetupWizard.tsx`, `WaLinkStep.tsx`, `auth/AuthShell.tsx`      | Shell, step indicator, `Field` (built-in password reveal), QR/phone linking unchanged |
| `src/admin/AiMemberPage.tsx`, `AiContextPanel.tsx`, `AiTryIt.tsx`        | Same save/turn-on logic; context item list; Try it                                    |
| `src/admin/AiConnectionSection.tsx`, `ai-status.ts`, `api/ai.ts`         | Same connection/login/logout mutations and readiness rules                            |
| `src/admin/SettingsPage.tsx`, `AdminLayout.tsx`, `TunnelPage.tsx`        | Tabs and nav; only labels change for Phone access                                     |
| `src/inbox/InboxPage.tsx`, `ChatList.tsx`, `components/app` `EmptyState` | Card passed as the existing `action` slot                                             |
| `docs/design-system.md`                                                  | Calm Desk tokens, shadcn primitives, 44 px touch targets, 360 px                      |

## Journey length

From first launch to the AI answering customers, in the mock (counted by `walkthrough.mjs`):
**9 interactions over 4 screens** vs about 25 over 7 today: business name, your name, password,
Continue, (scan on the phone; one demo click in the mock), Continue, fill in the business text,
Sign in with ChatGPT (plus the ChatGPT page itself, outside the app), Finish. Username needs no typing.

## Screen/state checklist (mock, 2026-10-15)

All captured at 1280 px and 360 px, light, by `walkthrough.mjs` on a fresh server per viewport: no page
errors, no horizontal overflow (the only console error is the expected 401 from `/api/me` before setup).

| #     | Screen / state                                                                                  | Result |
| ----- | ----------------------------------------------------------------------------------------------- | ------ |
| 01–02 | Account empty / filled (username auto-filled)                                                   | Pass   |
| 03–04 | WhatsApp QR with demo scan / linked                                                             | Pass   |
| 05    | AI step, not connected (template, ChatGPT recommended, note)                                    | Pass   |
| 06    | API key path: wrong key → clear error, nothing saved                                            | Pass   |
| 07–08 | ChatGPT signing in → connected, turn-on switch                                                  | Pass   |
| 09    | Ready: WhatsApp linked, AI on, secondary links                                                  | Pass   |
| 10    | Inbox Getting started (AI done → hidden; Teammates, Phone access)                               | Pass   |
| 11–13 | Sales Agent: AI on, Business context item, Try it answers "Teh Tarik RM4", Advanced closed/open | Pass   |
| 14    | Settings → AI: ChatGPT first + Recommended, Set up the Sales Agent, More AI features closed     | Pass   |
| 15–16 | Settings API key: Test key fails / passes                                                       | Pass   |
| —     | Real mouse click on the Recommended badge selects ChatGPT                                       | Pass   |
| 17    | Phone access page heading and nav label                                                         | Pass   |
| 18    | Sales Agent not connected: inline Connect the AI card                                           | Pass   |
| —     | Seeded mode: login, More AI features opens to Customer enrichment, Try it, Audit                | Pass   |

Not yet covered: dark theme captures; Malay/Chinese captures (strings added in all three catalogs);
the phone-number pairing path in the wizard (6 s auto-link) was not walked; ChatGPT sign-in
failure/expiry inside the wizard; Getting started for a non-admin (hidden by design); Skip paths
(Skip WhatsApp, Skip AI) beyond the code path; keyboard-only walk; a UI/UX designer review.

## Intentional changed/added files (vs the confirmed baseline)

Changed (13): `index.html` (title), `src/setup/SetupWizard.tsx`, `src/admin/AiMemberPage.tsx`,
`src/admin/AiConnectionSection.tsx`, `src/admin/SettingsPage.tsx`, `src/inbox/InboxPage.tsx`,
`src/inbox/ChatList.tsx`, `src/i18n/locales/{en,ms,zh-CN}/{admin,auth}.json`.
Added (3): `src/admin/AiQuickConnect.tsx`, `src/setup/AiAssistantStep.tsx`,
`src/inbox/GettingStartedCard.tsx`. Mock tooling: `run.ts` (`--fresh`, simulated sign-in,
deterministic answers), `proposal.ts` (demo scan, pairing auto-link, key test), `snapshot.mjs`
(also checks inherited baseline files), `walkthrough.mjs`, `README.md`, `reference.json`.
`snapshot.mjs --check`: 155 original files unchanged, 14 allowed deltas (13 from this proposal),
3 inherited enrichment files unchanged, 5 added files present.

## What remains simulated (mock only)

- ChatGPT sign-in: "signing in" for 2.5 s, then connected as owner@example.com; no ChatGPT page opens
  (production keeps today's sign-in tab and paste-the-address fallback).
- Test key: `POST /api/mock/ai/test-key` accepts `sk-` keys of 10+ characters. Production needs a new
  admin-only endpoint that makes one small real request with the unsaved key (never logged).
- WhatsApp linking (demo button / pairing auto-link), Cloudflare and push.
- Try it / live replies: deterministic best-matching Business context line, else hand-off.
- The business name lives only in the wizard (agent name and template). Production may store it as a
  setting. New installs defaulting to ChatGPT is done by the runner; production would change the
  server default for installs without a saved connection.

## Open questions for the owner

1. Should Business name be required (as mocked) or optional?
2. Should the wizard turn the AI on by default once connected (as mocked), or leave it off?
3. Keep Username visible (auto-filled) or hide it behind "Change"?
4. Getting started: keep the × "hide", and should it also appear when chats exist (mobile shows it
   only on an empty list)?
5. Is "Phone access" the right label, or "Remote access"/"Use outside this Wi-Fi"?

## Confirmation

Pending. A request to create, commit or show this mock is not confirmation and never authorises merging.

## Owner confirmation

Confirmed 2026-10-15 at mock revision `90a95dab5e992e2ea5d2daf773d613356b02f146`: "look good, use workflow
with multi agent to implement it". The open questions above take the mock's answers: business name
required; the AI turns on by default once connected; username visible and prefilled from your name;
the Getting started card hides when everything is done or when dismissed; the menu label is "Phone access".

## Implementation

Built on `feat/simple-first-setup` from the confirmed mock (`90a95da`), calling the real APIs.

**Production files**

- Server: `packages/shared/src/ai.ts` (`AiKeyTestBody`, `AiKeyTestResponse`, `AiKeyTestError`),
  `packages/server/src/ai/key-test.ts`, `routes/ai.ts`, `ai/settings-keys.ts` (default mode), `ai/service.ts`.
- Setup: `apps/web/src/setup/SetupWizard.tsx`, `AiAssistantStep.tsx`, `username.ts`, `agent-name.ts`.
- Admin: `apps/web/src/admin/AiQuickConnect.tsx` (shared by the wizard and the Sales Agent page),
  `use-chatgpt-sign-in.ts`, `AiMemberPage.tsx` (inline connect, closed Advanced section),
  `AiConnectionSection.tsx` (ChatGPT first, Test key, Set up the Sales Agent link, More AI features),
  `SettingsPage.tsx`; nav label "Phone access" (route `/admin/tunnel` unchanged).
- Inbox: `apps/web/src/inbox/GettingStartedCard.tsx` (admins only), `InboxPage.tsx`, `ChatList.tsx`.
- i18n: `mockSetup.connect.*` became `ai.connect.*` (admin), `mockSetup.started.*` became `gettingStarted.*`
  (inbox); `setup.ai.*` stays in auth. en, ms and zh-CN.

**Key test endpoint.** `POST /api/ai/connection/test` (admin, Origin check, 10 per minute per admin)
calls OpenAI `GET /v1/models` with an 8 s timeout and returns `{ ok, error }`: 401 → `invalid_key`,
403 → `forbidden`, 429 → `rate_limited`, anything else or a network failure → `unreachable`. It never
stores the key and logs only the result, status and duration. Only `invalid_key` blocks saving; after the
other errors the page offers **Save anyway**. Tests replace the client through `ctx.services.aiKeyTest`.

**Default mode.** A data dir with no saved connection defaults to ChatGPT mode. An older save without a
mode, or a stored API key, stays in API-key mode. The default never signs in or calls ChatGPT, and the AI
member stays off until an admin turns it on (the wizard turns it on only after a working connection).

**Differences from the mock**

- No "Proposed feature" badges, `/api/mock/*` calls, demo-scan button or fake delays.
- The business name is not stored on its own; the wizard uses it for the Sales Agent name and the
  Business context template.
- `AiQuickConnect` always opens on the ChatGPT option (the owner's main connection), even when the saved
  mode is `api` without a key.
- **Save anyway** after a key-test failure other than `invalid_key` is an addition beyond the mock; it
  needs a screen-review capture and the owner's confirmation.
- When Your name gives fewer than 3 usable characters (for example a Chinese-only name), the username
  is prefilled with `admin` instead of staying empty.

**Pending with the main agent:** e2e, the Dev Build check (real ChatGPT sign-in, a real key test against
`/v1/models`, the wizard end to end, the Getting started card) and the final screen review at
1280/360 px, light and dark.
