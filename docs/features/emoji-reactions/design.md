# Emoji reactions (receive and show)

Owner request (backlog: "Emoji reactions are not shown"): WhatsApp shows a reaction (e.g. 👍) as a small badge
under a message; EzyChat dropped them (`packages/wa/src/baileys/mapping.ts` returned null for
`reactionMessage`). Scope: **receive and show only**. The team cannot react from EzyChat yet (backlog).
Status: **proposal, self-reviewed by the agent** (delegated); the orchestrator shows it to the owner.

## Decisions

| Topic                   | Decision                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where                   | A pill under the bubble's inner corner (inbound: left, outbound: right), overlapping the bubble edge as in WhatsApp; the row gets extra bottom space so the next bubble never hides it.                                                                                                                                           |
| Grouping                | At most three distinct emojis (most used first, then the one used first) and the total when more than one person reacted.                                                                                                                                                                                                         |
| Who reacted             | Click or tap the pill: a popover lists every reaction (emoji + name). Desktop hover shows the summary as a `title` ("Reactions: 👍 2, ❤️ 1", also the accessible name).                                                                                                                                                           |
| Names                   | Server: customer profile → saved contact → direct chat name → contact push name → the WhatsApp name delivered with the reaction; never inferred, never from a re-pointed number. Web: a direct chat falls back to the header name, then `+digits`, then "Unknown contact" (a WhatsApp ID never shows its digits).                 |
| The linked number       | A reaction made on the linked phone shows as "You (phone)" (the team cannot react from EzyChat yet).                                                                                                                                                                                                                              |
| Change / removal        | One reaction per person and message: a new emoji replaces it, an empty one removes it (the badge disappears when nobody is left).                                                                                                                                                                                                 |
| Reaction before message | **Stored and shown later**: rows are keyed by the reacted message's stored key (`<waId>` / `<waId>#<inboxId>`), so a reaction that arrives before its message (history order, an own send not yet renamed from `local-…`) attaches as soon as the message is stored. A reaction for a message that never arrives stays invisible. |
| Ordering                | An older (history) reaction or removal never undoes a newer one (`reacted_at`); replays change nothing.                                                                                                                                                                                                                           |
| Notifications           | None: no push, no unread count, no chat reorder, no AI trigger.                                                                                                                                                                                                                                                                   |
| Duplicates (Baileys)    | Baileys emits a live reaction both as a `messages.upsert` message and as `messages.reaction`; only the upsert path is read. History sync: reaction messages and the `reactions` kept on history messages.                                                                                                                         |

## Source baseline

- Feature **claude-provider**, path `docs/features/claude-provider/mock/`, as on `main` at
  `21d97187bf30e6921658ee1fcd95c6109dd0b712` (release 0.1.49 + PR #145). `latestConfirmed` in `mock-index.json` is
  revision `f5d5ade`; `21d9718` carries that confirmed mock plus its round 2 (agent type change, PR #145, also
  delegated and self-reviewed). Copied from the clean working tree at that revision; the claude-provider
  screenshots and `claude-shots.mjs` were not copied (they stay in that folder).
- `reference.json` records the deltas: `snapshot.mjs --check` verifies the frozen app files, the 31 inherited
  files of earlier proposals (now including the claude-provider screens and `src/mock/claude.ts`) and the added
  files.

Reused screens and behaviour: the conversation (`Conversation.tsx`, `MessageList`, `MessageBubble.tsx`: bubble
shapes and colours, the group sender profile popover pattern, the reply button), shadcn `Popover` and `Button`,
the live message cache (`api/socket.ts` + `patchMessageInCache`, as for `message:status`), and the mock-only
dashed "Proposed" panel pattern (`EditionSwitch`).

## Mock

- Run: `npx tsx --conditions=ezychat-source docs/features/emoji-reactions/mock/run.ts --fake-wa`, then
  `http://localhost:7485/` (API `7484`). Walkthrough and checks: `mock/README.md`.
- Data: the mock runs this branch's server with the fake WhatsApp phone. Seeded and simulated reactions go
  through the dev route `POST /api/dev/fake-reaction` (fake WhatsApp only), so they are stored and pushed live
  like real ones. The "Simulate reactions from WhatsApp" panel is mock-only (`src/mock/ReactionSimulator.tsx`).
- Screenshots: `node docs/features/emoji-reactions/mock/reaction-shots.mjs` (7 states × desktop 1280 / mobile
  360 × light / dark) into `mock/screenshots/` — run by the orchestrator in the screen review.

## Screen and state checklist

| Area          | Screen / state                                                                                              | Mock |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| Direct chat   | One customer reaction under an outbound bubble (right corner)                                               | yes  |
| Direct chat   | The phone's reaction under an inbound bubble (left corner), "You (phone)" in the list                       | yes  |
| Direct chat   | Change (👍 → ❤️) updates live; removal makes the badge disappear                                            | yes  |
| Group         | Several different emojis grouped, most used first, with the total; at most three emojis in the pill         | yes  |
| Group         | List of who reacted: names from contacts/profiles/WhatsApp, a long name truncates, the phone's own reaction | yes  |
| Group         | Many reactions (7 people), then "Remove all"                                                                | yes  |
| Layout        | Desktop 1280 px and mobile 360 px, light and dark; no horizontal scroll; 44 px touch target on touch        | yes  |
| Accessibility | The pill is a button named "Reactions: 👍 2, ❤️ 1"; the list is a list of emoji + name                      | yes  |
| Not in scope  | Reacting from EzyChat (send), reactions in the chat list preview, notifications for reactions               | —    |

## Changed and added files (mock)

- Changed (already deltas of earlier proposals): `src/inbox/MessageBubble.tsx` (badge + row spacing),
  `src/inbox/Conversation.tsx` (simulation panel), `src/i18n/locales/{en,ms,zh-CN}/inbox.json`
  (`message.reactions.*` translated, `mockReactions.*` English in all three).
- Changed (frozen app files, now in `allowedDelta`): `src/api/socket.ts` (`message:reactions` handler),
  `src/api/queries.ts` (contract drift: the optimistic message gets `reactions: []`).
- Added: `src/inbox/ReactionBadges.tsx` (same component as `apps/web/src/inbox/ReactionBadges.tsx`),
  `src/mock/ReactionSimulator.tsx`, `reaction-shots.mjs`.
- Runner: `run.ts` (ports 7485/7484, temp-folder prefix, start message), `seed.ts` (seeded reactions), `README.md`,
  `reference.json`.

## Retention

Adding this sixth feature folder removed the oldest one by `creationOrder`, `docs/features/mcp-send-message`
(creation order 4; clean and committed; last revision with the folder `21d97187bf30e6921658ee1fcd95c6109dd0b712`,
recorded in `mock-index.json`).

## Implementation notes

- Contract: `MessageReactionSchema` and `Message.reactions` (default `[]`), socket `message:reactions`
  (`MessageReactionsPayload`), dev body `FakeReactionBody` (`packages/shared`).
- WhatsApp: `WaAdapterEvents.reaction` (`WaReaction`); `mapWAReaction` / `mapStoredReactions` in
  `packages/wa/src/baileys/mapping.ts`; `FakeWaAdapter.simulateReaction`. Checked against real WhatsApp
  2026-10-23 (receive only, history and live; `docs/dev-build-checks.md`).
- Server: migration `016_message_reactions.sql`, `messages/reactions.ts` (repo, row mapping through the alias
  store, batched presenter), `MessageService.applyReaction`, bus + socket `message:reactions` to the chat's
  inbox room, `POST /api/dev/fake-reaction` (fake WhatsApp only). Reactions are keyed by message id, so
  `mergeChat` has nothing to move.
- Web: `ReactionBadges` under each bubble, live cache update in `api/socket.ts`.

## Confirmation

Confirmed by the owner 2026-10-23: the orchestrator showed the screenshots `01-dm-outbound-badge-desktop-light`,
`04-group-badge-desktop-light` and `05-group-reaction-list-mobile-dark`, and the owner asked to complete the feature
("yes complet it"). Status `confirmed` in `mock-index.json`; it is now `latestConfirmed`.

Self-review before that, 2026-10-23:

- Mock `tsc` passes; `snapshot.mjs --check` passes (148 unchanged frontend files, 21 deltas, 31 inherited files,
  16 added files).
- The seeded mock starts and the server answers the seeded reactions (group: 👍 Nurul Huda, 👍 long name, 😋 Priya
  Nair, ❤️ phone; Farah: 👍 "Farah Aziz" from her profile; Jason: 🙏 phone).
- Reviewed in code against `docs/design-system.md`: token classes only (`bg-surface`, `text-muted-foreground`),
  shadcn `Button` + `Popover`, `shadow-sm` only, popover width capped at `100vw - 2rem` for 360 px, names
  truncate, a 44 px hit area on touch screens (`pointer-coarse:after:-inset-2` around the 28 px pill).
- Not done by the agent (owner rule: the orchestrator runs it once): the screenshot round
  (`reaction-shots.mjs`), the designer screen review and the owner's look at the screenshots.

## Screen review (real app, 2026-10-23)

Demo data (`e2e/marketing-screenshots.mjs`: Priya's ❤️ on a staff reply, the phone's 🙏, three regulars in the
group), desktop 1280 / mobile 360, light and dark (`docs/screenshots/chat/conversation-*`,
`group-reactions-*`).

- Fixed: on an outbound bubble the badge (under the right corner, as in the mock) covered the time and the
  ticks. The meta line now gets `pb-3` when the message has reactions (app and mock); `e2e/reactions.spec.ts`
  checks that the badge starts below the time.
- Fixed (demo data, older than this feature): the group member "Daniel Lim" had Priya's number, so her chat
  showed his name.
- Kept: the reaction list opens over the next message (a popover, closed with Escape or a tap outside).
