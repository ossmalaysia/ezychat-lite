# AI agents in WhatsApp groups

Status: **proposal** (mock for the owner's review). Branch `feat/ai-groups` from `main` (`ecbb092`).

## Owner request (2026-10-28)

- "is sales agent or custom agent work in group?" Today no agent answers in a group: `ai/service.ts` `onInbound`
  returns for every chat that is not a direct chat (`chat.type !== 'dm'`), for every preset.
- The owner agreed ("ok") to the recommended start: the AI answers in a group **only when someone @mentions the
  business number**, and **only in groups an admin switches on**.

## Why

Businesses run WhatsApp groups with customers (a class, a project, a reseller group). Members ask questions there
("@Kopi Apong what time do you open?") and the team answers by hand. An AI that answers every group message would
spam the group and talk to people who are not customers, so the default stays off and the trigger stays explicit.

## Baseline

- Cloned from the owner-confirmed **connector-list** mock (`latestConfirmed`, revision
  `9a5643920855cdc27449cbb4f4c3c7d6965eee06`), the whole app.
- Reused, not changed: group chats in the inbox (header, members panel `GET /chats/:jid/members`, mentions shown as
  names), the agent page (`/admin/members/ai/:agentId`, sections Business context, Connectors), Try it, chat events
  ("AI took this chat", hand-over lines), hand-over push notifications, the Activity/audit patterns.
- Retention: this is a new feature folder (6th); the oldest, `ai-reply-suggestions` (last revision
  `ec780545d2a221a551c3a710a7dba5c18e434878`), is pruned in the same change (git history keeps it).

## Behaviour (proposal)

| Rule                    | Default                                                                                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switch per agent        | **Answer in groups**: off. When off, nothing changes from today.                                                                                                                                                                                                                         |
| Which groups            | Only groups an admin switches on (per group: in the group's info panel, and as a list on the agent page). New groups start off.                                                                                                                                                          |
| Trigger                 | A live message that **@mentions the business number** (WhatsApp mention, `mentionedJids`, own JID or LID), or that **replies to (quotes) a message the business sent** in that group. Nothing else: no keyword guessing, no history, no message from the business number itself.       |
| Who it answers          | The member who asked, in the group, quoting their message and naming them. Never a private message to a member.                                                                                                                                                                         |
| Ownership               | The AI does **not** take the group chat: the group keeps its assignee. Each answer is one event ("AI answered Aisyah's question").                                                                                                                                                     |
| Hand-over               | When the AI cannot answer (hand-off rules, missing knowledge, a request to change something), it writes one short line in the group ("A team member will reply soon.") and notifies the group's assignee, else every teammate with access to the inbox. Same reasons as direct chats. |
| Knowledge               | The agent's Business context and instructions, as in direct chats; the conversation part is the **last 20 messages of the group** with member names (no phone numbers).                                                                                                                  |
| Connectors              | Look-up tools only (e.g. check free times). Tools that change data (bookings, quotations) are **never** offered in groups in this round.                                                                                                                                                |
| Limits                  | At most **20 AI answers per group per hour** and **3 in a row** without a human message; above that it stays silent and the chat shows "AI paused: too many questions in a row".                                                                                                        |
| Try it                  | A "Group question" option in Try it shows how the agent would answer a mention (nothing is sent).                                                                                                                                                                                       |
| Reply suggestions       | Unchanged (not in groups).                                                                                                                                                                                                                                                              |

## Screens (mock checklist)

1. **Agent page → Groups card** (`/admin/members/ai/:agentId`): switch *Answer in groups (when mentioned)*,
   explanation, the list of the inbox's groups with a switch each, the limits, a link to each group. States: off,
   on with no group switched on, on with groups, inbox without groups, long group names, agent of another inbox.
2. **Group chat header**: a small "AI answers when mentioned" badge on switched-on groups.
3. **Group info panel** (members panel): row *AI agent answers when mentioned* with a switch (admins) or the state
   (agents); disabled with a hint when the agent's *Answer in groups* is off.
4. **Group conversation**: a member's message with an @mention of the business, the AI's quoted answer, the event
   line, a hand-over line + "A team member will reply soon.", the "AI paused" line after the limit.
5. **Notifications**: the hand-over push/desktop notification text for a group ("Sales Agent needs you in
   *Kopi Lovers* (Aisyah)").
6. **Try it**: "Group question" toggle and the answer preview.
7. Mobile 360 px and dark mode for each; Malay and Chinese texts.

## Not in this round

- Answering without a mention, keyword triggers, or answering every message.
- Tools that change data in groups; private follow-up messages to group members.
- Suggest reply / grey text in groups.
- Groups the business number is not in, or announcement-only communities.

## Open questions for the owner

1. Should a **reply to the business's message** also trigger the AI, or only an @mention?
2. Is **20 answers per group per hour** right?
3. On hand-over in a group, is the one line "A team member will reply soon." good, or should the AI stay silent?
