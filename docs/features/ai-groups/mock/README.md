# AI agents in WhatsApp groups: interactive app proposal

A clone of the owner-confirmed **connector-list** reference (the whole app, `latestConfirmed` revision
`9a564392`, cloned unchanged at `9c2b6007`) with the **ai-groups** proposal on top: an AI agent answers in a
WhatsApp group when a member @mentions the business number, only in groups an admin switches on. Scope, rules and
the screen checklist: [../design.md](../design.md) (including the owner's answers of 2026-10-28: the AI answers only an @mention
or a quote of an AI message, the loop guard instead of hourly limits, the hand-over line).

Every inherited flow still works (connectors, Reports, Google Calendar, reply suggestions, phrase list, reactions,
inboxes, AI agents). Mock-only control texts are English in all three catalogs; the new user-facing texts have
Malay and Chinese.

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/ai-groups/mock/run.ts --fake-wa
```

Open `http://localhost:7489/` (API on `127.0.0.1:7488`; `MOCK_UI_PORT` / `MOCK_API_PORT` change them). The seed
takes about a minute (the AI replies go through the real send queue). Nothing calls WhatsApp, OpenAI, Anthropic,
Google or a partner: the runner blocks every outside request. The group behaviour is a stand-in
(`groups.ts`, routes `/api/mock/groups*`); the AI's group answers are fixed demo texts from the seeded Business
context, sent through the normal message service as the AI member. Add `?edition=enterprise` to see the second
agent (Sofia, inbox Catering).

## Seed data

| Group (inbox Kopi Apong)                                                                                               | Answering | What it shows                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kopi Lovers Club** (6 members, assigned to Daniel)                                                                   | On        | Members chatting; Nurul's "@Kopi Apong what time does the kitchen close tonight?" and Aina's quoted answer; Nurul replies to that answer and gets a second answer; Tan Wei Jie's unrelated message gets no reply; Arjun quotes the AI's first answer (no @mention) and gets an answer; Farah asks to change an order: "A team member will reply soon." + hand-over line; Daniel is notified. |
| **Reseller Group Penang – Kopi Apong wholesale partners (Butterworth, Bayan Lepas, Georgetown & Seberang Perai)** (20) | On        | Long name. Kavitha's question is answered, then another business's auto-reply bot answers every AI message: after 10 AI answers in a row with no teammate, the loop guard writes "AI paused: many answers in a row" and the AI stays quiet.                                                                                                                                                  |
| **Family Day 2026** (34)                                                                                               | Off       | A member's @mention gets no AI answer (no badge in the header).                                                                                                                                                                                                                                                                                                                              |
| Kopi Apong Regulars (inherited)                                                                                        | Off       | The earlier group (reactions demo), not a demo group for simulations.                                                                                                                                                                                                                                                                                                                        |

Aina's "Answer in groups" switch starts **on**; Sofia's (Catering, no groups) starts off. The seeded AI member
itself stays **off** as in the baseline, so the Groups card shows the "Aina is off" hint; the mock answers mentions
as if Aina were on. The fake phone's own number is named "Kopi Apong", so mentions of it read "@Kopi Apong".

## Walkthrough

1. Sign in as `aisyah`. **Admin → Members → Aina** (`/admin/members/ai/a1`): the **Groups** card under Connectors:
   the switch _Answer in groups (when mentioned)_ with its explanation, the "Aina is off" hint, the groups of Kopi
   Apong with a switch each and a link to the chat (the long reseller name wraps; it shows "Paused: many answers in
   a row"), the loop-guard line and "only looks things up". Switch it off: one line "Kopi Apong is in 4 groups…".
   Switch it on and every group off: "No group is switched on yet". **Sofia** (`/admin/members/ai/a2?edition=enterprise`):
   "Catering is not in any WhatsApp group yet". The dashed **Mock only** panel at the bottom of the card switches
   Answer in groups, **Loop guard reached**, **View as** Admin / Agent, shows the last group hand-over
   notification and resets the demo.
2. **Inbox → Kopi Lovers Club**: header badge "AI answers when mentioned"; the mention, the answer bubble labelled
   "Aina (AI)" quoting Nurul, the follow-up and its answer, the unrelated message (no reply), the lines "Aina
   answered Nurul Huda" / "…'s follow-up" / "handed Farah Aziz's question to the team", and "A team member will
   reply soon.".
3. **Reseller Group Penang…**: the badge reads "AI paused"; scroll down for the bot loop and the paused line.
   **Family Day 2026**: no badge, the mention is not answered.
4. **Group info** (click the group name): the row _AI agent answers when mentioned_ with a switch. Mock only
   panel → View as **Agent**: the row shows On/Off and "Only admins can change this." Turn Answer in groups off: the
   switch is disabled with "Answer in groups is off for Aina…" and a link to the agent page. (Signing in as
   `daniel` shows the agent view for real.)
5. In a demo group open the chat's **Simulate AI in groups** panel (Mock only, collapsed at the top of the
   conversation): _A member @mentions the business_ (answered), _The same member replies to the AI_ (answered),
   _Another member writes_ (silence, nothing sent), _A member asks for a change_ (hand-over line, event and the
   notification preview "Aina needs you in Kopi Lovers Club" to Daniel), _A teammate replies_ (the loop guard
   starts again). Set **Loop guard reached** to Yes and mention again: "AI paused: many answers in a row".
6. **Try it** on Aina's page: switch **Group question** on and ask "What time does the kitchen close?": the preview
   says "In a group · reply to Nurul Huda · Nothing is sent to the group", quotes the question and answers "Hi
   Nurul! …" (no "Does that answer your question?"). A question without an answer gives "A team member will reply
   soon.". A booking question only offers free times: "a teammate makes the booking".

## Changed for this proposal

Reference: `reference.json` keeps the frozen baseline hashes (`files`, `inheritedUnchanged` now also pins the
connector-list proposal's files) and lists this proposal under `proposalChanged` / `proposalAdded`.

- Changed (frontend): `src/admin/AgentPage.tsx` (Groups card), `src/admin/AgentTryIt.tsx` (Group question),
  `src/inbox/ConversationHeader.tsx` (badge), `src/inbox/GroupPanel.tsx` (Group info row),
  `src/inbox/Conversation.tsx` (Mock only panel), `src/inbox/EventItem.tsx` (group lines), and the `en`, `ms`,
  `zh-CN` `admin.json` / `inbox.json` catalogs (`mockGroups.*`, `events.mockGroup*`).
- Added (frontend): `src/admin/AgentGroupsCard.tsx`, `src/inbox/GroupAiRow.tsx` (row and header badge),
  `src/mock/groups.ts` (client of the stand-in routes), `src/mock/GroupsMockControls.tsx` (Mock only panel and the
  notification preview).
- Runner: `groups.ts` (added: state, seed, routes), `proposal.ts` (registers it), `seed.ts` (calls `seedGroups`),
  `run.ts` (ports 7489/7488, temp-folder name, ready line, the fake phone named "Kopi Apong"), every `*-shots.mjs`
  defaults to port 7489, `groups-shots.mjs` (added), `reference.json`.

Not shown: real push or desktop notifications (the mock shows the notification text in the Mock only panel);
answering while the agent itself is off (the mock answers as if on, with the hint on the card).

## Checks

```powershell
npx tsc -p docs/features/ai-groups/mock/tsconfig.json
node docs/features/ai-groups/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts; light and dark, 1280 px and 360 px touch; installed
# Chrome unless PW_CHROMIUM is set). It changes the mock's data: restart the mock afterwards.
node docs/features/ai-groups/mock/groups-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
`connector-list-shots.mjs`, `calendar-shots.mjs`, `reports-shots.mjs`, `phrase-shots.mjs`, `suggest-shots.mjs`,
`business-api-shots.mjs`, `upgrade-shots.mjs`, `send-reaction-shots.mjs`, `reaction-shots.mjs`, `agent-shots.mjs`
and `inbox-shots.mjs` are inherited scripts (pointed at this mock's port).
