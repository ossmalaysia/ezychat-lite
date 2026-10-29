# AI in groups: Open chat, all groups and per-group choices

Status: **confirmed** 2026-10-28 (see Confirmation). Branch `feat/ai-groups-open-chat` from `main` (`8a3f44f7`).

## Owner request (2026-10-28)

- "improve the ai chat group chat setting, we need enable for all group chat setting, also allow to configure chat in
  few select group, and we can control AI only response to quote and tagged, or AI can response if they think they
  should response".
- Open chat rules (owner): "AI will response to people asking AI question, tag, quote AI msg or id, or it is in
  discussion mode or open question related to AI role and responsibility, AI will not response if question is target
  some one, AI will not discuss sensitive, political, races and gender".
- Mode names (owner): "openchat mode, or tag and quote mode".
- The owner agreed ("yes, build it") to: the agent's **Which groups** (All groups, new groups too / Selected groups
  only) and **default mode**, plus a per-group choice (the agent's default / Open chat / Tag and quote / Off) in the
  group's info panel and in the list on the agent page.

## Baseline

- Cloned from the owner-confirmed **ai-groups** mock (`latestConfirmed`, revision
  `ea63248ff0e7a529c95978a5ac82af464e5e0d70`; the folder on `main` `8a3f44f7` is identical), the whole app.
- Reused: the agent page Groups card, Group info row, header badge, group event lines, Mock only panel, Try it group
  question, loop guard, hand-over line and notification, look-ups only in groups.
- The copied `screenshots/` of earlier features are not kept in this folder (they stay in the earlier folders and in
  git history); this folder keeps only its own `oc-*` shots.
- Retention: this is the 6th feature folder; the oldest, `ai-phrase-dictionary` (creation order 14, last revision
  `8a3f44f7`), is removed in the same change.

## Behaviour

| Rule             | Proposal                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Answer in groups | Per agent, off by default (unchanged).                                                                                                                                                                                                                                                                                                                                                     |
| Which groups     | Per agent: **All groups** (every group of the inbox, new groups too) or **Selected groups only** (only groups turned on; new groups start off).                                                                                                                                                                                                                                            |
| Default mode     | Per agent: **Tag and quote** (default) or **Open chat**.                                                                                                                                                                                                                                                                                                                                   |
| Per group        | **Default (the agent's mode)**, **Open chat**, **Tag and quote** or **Off**. A group never set follows the agent: All groups → the default mode; Selected groups only → Off. Choosing "Default" in Selected groups only turns the group on with the agent's mode.                                                                                                                          |
| Tag and quote    | Unchanged: answers only an @mention of the business number or a quote of an AI message.                                                                                                                                                                                                                                                                                                    |
| Open chat        | Also answers: the agent's name ("Aina, is Kopi O still RM3.50?"), the member the AI just answered going on without a tag (discussion mode, until a teammate writes), and an open question to the group that is part of the agent's role ("Anyone know if Kopi Apong delivers to Jelutong?"). Silent: a question for a specific person (a name or a tag of someone else), members chatting. |
| Sensitive topics | Both modes: never politics, race, religion or gender. Tagged or quoted → one polite line ("Sorry, I can't discuss that topic here. I'm happy to help with orders, the menu or delivery.") and the event "did not discuss a sensitive topic"; otherwise silence. (Religion added by my call: the Malaysian "3R" topics.)                                                                    |
| Open chat cost   | In Open chat each new group message needs one short decision call on the fast model ("Model for suggestions" fast model); the card says so. Tag and quote needs no call for messages it does not answer.                                                                                                                                                                                   |
| Unchanged        | Loop guard (10 AI answers in a row without a teammate), hand-over line and notification, look-ups only, the group keeps its assignee, Try it group question.                                                                                                                                                                                                                               |

## Screens (mock checklist)

1. **Agent page → Groups card**: switch; _Which groups_ cards; _How {name} answers_ cards; the cost line when a
   group is in Open chat; the group list with a choice per group (status: members · mode / Off / Paused); rules
   (sensitive topics, loop guard, look-ups only). States: all groups, selected only, Open chat default, off, no
   groups, the choice list open, long names, 360 px, dark, Malay and Chinese.
2. **Group info**: _AI agent in this group_ with the same choice (admins) or the mode as a badge (agents); disabled
   with a hint when Answer in groups is off.
3. **Header badge**: "AI in open chat" or "AI answers when tagged or quoted" (or "AI paused").
4. **Group conversation** (Kopi Lovers Club in Open chat): tag answered, quote answered, follow-up without a tag
   answered, members chatting and a question for a member not answered, an open question answered ("answered … in
   open chat"), a tagged election question with the polite line, a hand-over.
5. **Mock only panel**: the new cases (goes on without a tag, names the AI, open question, a question for a person,
   politics with and without a tag) next to the earlier ones.

## Not in this round

- A per-group list of topics or keywords; answering every message; private follow-ups to members.
- Tools that change data in groups (unchanged).
- A per-group cost limit for Open chat (the loop guard stays the only limit).

## Build plan (after confirmation)

1. **Contract** (`packages/shared/src/ai-groups.ts`): `AiAgentGroups` + `scope` (`all`|`selected`) and `mode`
   (`open`|`tag`) with zod defaults (`selected`, `tag`); `AiGroupRow.setting` (`default`|`open`|`tag`|`off`) and
   `mode` (effective, `off` when off); `AiAgentGroupsBody` partial (`enabled?`, `scope?`, `mode?`);
   `AiGroupChatBody { setting }` (old `{ enabled }` still accepted: true → `default`, false → `off`);
   `AiGroupEvent.kind` + `declined`, `openChat?`. New fields get defaults (Enterprise rule).
2. **Server**: migration 025 — `ai_agents.group_scope` (default `selected`), `ai_agents.group_mode` (default `tag`),
   `ai_group_chats.setting` (`enabled = 1` → `default`, `0` → `off`; kept rows only); `ai/groups.ts` resolves the
   effective mode; Open chat decision: one structured call on the fast model (`ai/group-gate.ts`: reach =
   named / continue / open / person / chat, sensitive yes/no; last 8 group messages with names, the agent's name and
   role summary; never knowledge) run only for untagged, unquoted messages in Open-chat groups, with the existing
   debounce; tag/quote stay rule-based; the sensitive check also runs for tags and quotes (decision call or the
   group turn's own output); `GUARDRAILS` gets the no-politics/race/religion/gender rule; logs: ids, reach, outcome,
   ms only; upgrade test seed extended.
3. **Web**: Groups card, Group info choice, header badge texts, event lines, i18n en/ms/zh-CN from the mock, tests.
4. Tests (mock model for the gate), e2e, Dev Build check (mock model), screen review against the mock, packaged
   smoke if the release review asks for it.

## Confirmation

The owner reviewed the review page (https://claude.ai/artifact/8kfxQKREzkGkX1VnThNwT2: Groups card with Which groups,
the default mode and a choice per group; Kopi Lovers Club in Open chat; Group info choice and agent view; the open
question in Tag and quote, politics with a tag; dark, computer, Malay and Chinese), with the questions on religion as a
sensitive topic and the defaults for existing and new agents (Selected groups only, Tag and quote), and confirmed on
2026-10-28 ("confirm can implement"). Mock revision `8776f52b0cc054c3123459adc41f7c6f16e92aef`.

## Build notes (calls made while building)

- The Open-chat decision (`ai/group-gate.ts`) is one structured call on the **connection's fast model** (not the
  "Model for suggestions" choice). It sees the agent's name, its instructions (first 1,000 characters), the last 8
  group messages and the message; never the business knowledge. If it fails, the AI stays silent. A message that tags
  another member makes no call.
- The sensitive-topic check also runs (same call) for a tag or a quote with text; if it fails the AI still answers.
- The no-politics/race/religion/gender rule is in the fixed `GUARDRAILS`, so it also applies in direct chats. Both the
  guardrail and the gate say that factual business questions that only touch these words (halal food, opening hours
  on a festive or prayer day, a product or class for women or men) are normal questions.
- The polite line is fixed and generic: "Sorry, I can't discuss that topic here. I'm happy to help with questions
  about our business." (English, like "A team member will reply soon.").
- Follow-up: Try it has no Open-chat option yet (its group question acts as a tag).
