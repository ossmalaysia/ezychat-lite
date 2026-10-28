# AI in groups: Open chat, all groups and per-group choices — interactive app proposal

A clone of the owner-confirmed **ai-groups** reference (the whole app, `latestConfirmed` revision `ea63248`,
identical on `main` `8a3f44f7`) with the **ai-groups-open-chat** proposal on top: each AI agent answers in **all
groups** (new groups too) or **selected groups only**, with a default mode — **Tag and quote** (unchanged) or **Open
chat** (also its name, follow-ups without a tag and open questions in its role; silent for questions to a specific
person and for members chatting) — and each group can use the default, Open chat, Tag and quote or Off. In both
modes the AI never discusses politics, race, religion or gender. Scope and rules: [../design.md](../design.md).

Every inherited flow still works (AI in groups, connectors, Reports, Google Calendar, reply suggestions, phrase list,
reactions, inboxes, AI agents). Mock-only control texts are English in all three catalogs; the new user-facing texts
have Malay and Chinese.

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/ai-groups-open-chat/mock/run.ts --fake-wa
```

Open `http://localhost:7489/` (API on `127.0.0.1:7488`; `MOCK_UI_PORT` / `MOCK_API_PORT` change them). The seed
takes about a minute. Nothing calls WhatsApp, OpenAI, Anthropic, Google or a partner. The group behaviour is a
stand-in (`groups.ts`, routes `/api/mock/groups*`): fixed demo answers from the seeded Business context and fixed
rules instead of the production decision call.

## Seed data (inbox Kopi Apong; Aina: Answer in groups on, All groups, default Tag and quote)

| Group                      | Choice                  | What it shows                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kopi Lovers Club**       | Open chat               | Members chat (no reply); Nurul's tag answered; her quote answered; she goes on without a tag ("ok, and on public holidays also open?") and is answered; Siti's open question about delivery answered; Tan's "Siti, are you coming…" not answered; Arjun's quote answered; Arjun's tagged election question gets the polite line; Farah's change request is handed over. |
| **Reseller Group Penang…** | Default (Tag and quote) | The auto-reply bot loop and the loop guard (unchanged).                                                                                                                                                                                                                                                                                                                 |
| **Family Day 2026**        | Off                     | A mention is not answered.                                                                                                                                                                                                                                                                                                                                              |
| Kopi Apong Regulars        | not set                 | Follows All groups: Default (Tag and quote).                                                                                                                                                                                                                                                                                                                            |

## Walkthrough

1. **Admin → Members → Aina**: the Groups card. _Which groups_ (All groups / Selected groups only), _How Aina
   answers_ (Tag and quote / Open chat), the cost line (a group is in Open chat), the groups with a choice each, the
   rules (sensitive topics, loop guard, look-ups only). Switch to Selected groups only: Kopi Apong Regulars (not set)
   becomes Off. Choose Open chat as the default: every Default group follows.
2. **Inbox → Kopi Lovers Club**: badge "AI in open chat"; the lines "answered … in open chat" and "did not discuss a
   sensitive topic with Arjun Pillai". **Reseller Group Penang…**: "AI answers when tagged or quoted" / "AI paused".
3. **Group info**: _AI agent in this group_ with the choice (admins) or the mode (Mock only → View as Agent).
4. **Simulate AI in groups** (Mock only, in a demo group): the earlier cases plus _The same member goes on without a
   tag_, _A member names the AI_, _A member asks the group an open question_ (answered in Open chat, silent in Tag
   and quote), _A member asks a specific person_ (silent), _A member raises politics (no tag)_ (silent), _A member
   tags the AI about politics_ (polite line).

## Changed for this proposal

`reference.json` keeps the frozen baseline hashes, pins the unchanged ai-groups proposal files
(`inheritedUnchanged`) and lists this proposal's files.

- Changed (frontend): `src/admin/AgentGroupsCard.tsx`, `src/inbox/GroupAiRow.tsx`, `src/inbox/EventItem.tsx`,
  `src/mock/groups.ts`, `src/mock/GroupsMockControls.tsx`, the `en`, `ms`, `zh-CN` `admin.json` / `inbox.json`.
- Runner: `groups.ts` (modes, choices, the new cases, seed), `groups-shots.mjs` (group call), `run.ts` and the
  inherited `*-shots.mjs` (paths), `open-chat-shots.mjs` (added).

## Checks

```powershell
npx tsc -p docs/features/ai-groups-open-chat/mock/tsconfig.json
node docs/features/ai-groups-open-chat/mock/snapshot.mjs --check
# With the seeded mock running (light and dark, 1280 px and 360 px touch; installed Chrome unless PW_CHROMIUM is
# set). It changes the mock's data: restart the mock afterwards.
node docs/features/ai-groups-open-chat/mock/open-chat-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
