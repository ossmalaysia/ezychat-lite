# Send emoji reactions (team)

Owner request 2026-10-23 ("how to add reaction in desktop? using mouse?", then "yes" to the proposed design):
team members react to a message from EzyChat, as on WhatsApp Web. Builds on **emoji-reactions** (receive and
show, PR #157). Status: **confirmed** (see Confirmation).

## Decisions

| Topic              | Decision                                                                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry (mouse)      | A 🙂 button beside the bubble, next to the Reply button (closest to the bubble), shown on hover and on keyboard focus. Click opens the emoji bar above the message.                                                                                                    |
| Entry (touch)      | Press and hold the message opens the bar (before: press and hold started a reply). The bar has a Reply row, so reply stays one tap away; swipe right still replies. The 🙂 button stays a hidden real control for screen readers and keyboards, like the Reply button. |
| Bar                | 👍 ❤️ 😂 😮 😢 🙏 and **+** (40 common emojis in a grid, no emoji library). The current reaction is highlighted (`aria-pressed`); an emoji not in the bar shows first.                                                                                                 |
| One per number     | WhatsApp keeps **one reaction per number**, so the team shares the linked number's reaction: a new emoji from any teammate replaces it (also one made on the phone), the same emoji again removes it. The bar says so when a teammate's reaction is current.           |
| Who reacted (list) | The linked number's reaction shows "You" (the signed-in user sent it), "<name> (team)" (another teammate) or "You (phone)" (the phone or another linked device). Customers see only the business number's reaction.                                                    |
| Remove             | Select the same emoji again, or **Remove** on the linked number's row in the reaction list.                                                                                                                                                                            |
| Who may react      | Whoever may reply in the chat (same rule as Reply: not on a removed inbox's read-only chats, not on a message that is still `local-`).                                                                                                                                 |
| WhatsApp offline   | The bar opens with its emojis disabled and "WhatsApp is not connected. You can react when it is back." (reactions are not queued: a late reaction is confusing).                                                                                                       |
| Failure            | A toast "The reaction was not sent" with the server message; the badge changes only when WhatsApp confirms (the normal `message:reactions` event).                                                                                                                     |
| Not in this round  | The AI assistant reacting (e.g. 👍 to "ok thanks" instead of a reply): owner to decide later. Reactions from the MCP send tool. Notifications for reactions.                                                                                                           |

## Source baseline

- Feature **emoji-reactions**, path `docs/features/emoji-reactions/mock/`, on branch `feat/emoji-reactions` at
  `988db65a` (`latestConfirmed` revision `6d17669` plus its screen-review fix: room under the time for the badge).
- `reference.json` records the deltas; `snapshot.mjs --check` verifies the frozen app files and the inherited files.

Reused: `MessageBubble` (Reply button pattern, hover/focus visibility, `pointer-coarse` hiding), `useSwipeReply`
(press-and-hold), `ReactionBadges` (badge, list), shadcn `Popover` and `Button`, `WaBanner` helpers
(`waSendingBlocked`, `waQueuesMessages`) for the offline state, the mock-only simulation panel.

## Mock

- Run: `npx tsx --conditions=ezychat-source docs/features/send-reactions/mock/run.ts --fake-wa`, then
  `http://localhost:7483/` (API `7482`). Walkthrough: `mock/README.md`.
- Effects: the mock-only routes in `mock/send-reactions.ts` stand in for the app's future route:
  `POST /api/mock/react` makes the fake phone send the linked number's reaction and remembers the teammate's name
  (memory only); `GET /api/mock/react` lists the names; `POST /api/mock/wa-offline` takes the fake phone offline.
  The browser side is `src/mock/useSendReaction.ts`.
- Screenshots: `node docs/features/send-reactions/mock/send-reaction-shots.mjs` (desktop 1280 / mobile 360,
  light / dark) into `mock/screenshots/`.

## Screen and state checklist

| Area         | Screen / state                                                                 | Mock |
| ------------ | ------------------------------------------------------------------------------ | ---- |
| Desktop      | 🙂 button on hover beside an inbound and an outbound bubble                    | yes  |
| Desktop      | Bar open; select 👍; badge shows; list says "You" with Remove                  | yes  |
| Desktop      | Bar with the current emoji highlighted; **+** grid of 40 emojis                | yes  |
| Teammate     | Another member sees "Aisyah (team)" in the list and the "replaces it" note     | yes  |
| Offline      | Bar disabled with the warning text                                             | yes  |
| Phone (360)  | Press and hold opens the bar with Reply; list and grid fit the width           | yes  |
| Keyboard     | Tab to the 🙂 button (visible on focus), Enter opens the bar, Escape closes it | yes  |
| Not in scope | AI reactions, MCP reactions, reaction notifications                            | —    |

## Changed and added files (mock)

- Changed: `src/inbox/MessageBubble.tsx` (🙂 button, picker state, names), `src/inbox/ReactionBadges.tsx` (team
  names, Remove), `src/inbox/useSwipeReply.ts` (press-and-hold option), `src/mock/ReactionSimulator.tsx` (offline
  buttons), `src/i18n/locales/{en,ms,zh-CN}/inbox.json` (`message.reactions.*` translated; mock keys English).
- Added: `src/inbox/ReactionPicker.tsx`, `src/mock/useSendReaction.ts`, `send-reactions.ts`, `send-reaction-shots.mjs`.
- Runner: `run.ts` (ports 7483/7482, temp-folder prefix), `proposal.ts` (registers the routes), shot scripts'
  default port.

## Implementation notes (for after confirmation)

- WhatsApp: `WaAdapter.sendReaction(chatJid, targetKey, emoji)` (Baileys `sendMessage(jid, { react: { text, key } })`,
  `text: ''` removes); the target key needs `fromMe` and, in groups, `participant`.
- Server (as built): `PUT /api/messages/:id/reaction` `{ emoji }` (`''` removes; message-id route like
  retry, so `requireMessageAccess` gives 404 outside the caller's inboxes), 503 when WhatsApp is not connected,
  30 reactions a minute per user; store `sent_by_user_id` on the linked number's reaction row (cleared when the phone
  reacts) so the list can name the teammate; audit without the emoji text is not needed (no customer data).
- Contract: `MessageReaction.sentByUserId` (zod default `null`).
- Must be smoke-tested against real WhatsApp with a **test number** (this one sends).
- Stale build (owner note): checked during the build. The app's service worker already activates a new build at
  once (`registerType: 'autoUpdate'`, `skipWaiting`, `cleanupOutdatedCaches`) and the desktop clears the cache
  on a version change. The mock problem came from another app's service worker on the same localhost port.

## Retention

Adding this sixth feature folder removes the oldest by `creationOrder`, `docs/features/token-permissions`
(creation order 5; clean and committed; last revision with the folder `988db65a`, recorded in `mock-index.json`).

## Confirmation

Confirmed by the owner 2026-10-23 after trying the running mock at `http://localhost:7483` (hover a message, the
🙂 button, the emoji bar): "ok look fine". Status `confirmed` in `mock-index.json`; it is now `latestConfirmed`
(revision `82c8419`). The AI assistant reacting stays out of this round.

Note from the owner's first try: the browser showed an old EzyChat build that a service worker (`sw.js`) had
cached on `localhost:7483` from an earlier app on that port, so the 🙂 button was missing. Unregistering the
service worker fixed it. The real app must not show a stale cached build after an update (check during the build).
