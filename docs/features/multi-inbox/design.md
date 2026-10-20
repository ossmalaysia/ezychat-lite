# Several WhatsApp numbers (inboxes)

Owner requests (2026-10-21): "can we do backward to design multi number case with bailey first? than we
allow each number or instance to connect via whatsapp business api or go back to bailey"; "now we want to
allow support multiple number connection, do a mock design, also review all screen how it affect inbox view
and others, as simple admin will able to see all inbox, and team member agent can assign to which inbox only,
and the inbox should be unified view, only the user have the inbox permission able to see the customer
chat"; on the first mock: "how come inboxes missing personal whatsapp connect? … we should not do whatsapp
business api first"; then: "remove the whatsapp business API connection type for now, we do it later".
Status: **mock round 3 waits for the owner**.

## Goal

A team runs several WhatsApp numbers (for example the shop and Catering) in one EzyChat. Each number is an
**inbox**, linked with the **WhatsApp app on its phone** (QR scan, as the app works today). Admins see every
inbox; an agent sees only the inboxes an admin gave them. Everyone works in **one unified list**.

## Decisions

| Decision                                                                                                                                                                                                      | By              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Several numbers: one inbox per number.                                                                                                                                                                        | Owner           |
| Every inbox is a WhatsApp app on a phone (linked phone, Baileys, QR scan as today).                                                                                                                           | Owner (round 3) |
| The WhatsApp Business API is a later step, as a second inbox type (see "Later").                                                                                                                              | Owner (round 3) |
| Admins see all inboxes; an agent gets access to chosen inboxes only.                                                                                                                                          | Owner           |
| One unified chat list of every inbox the user may open (not one page per number).                                                                                                                             | Owner           |
| Only a user with access to the chat's inbox can see that chat (list, conversation, search, notifications, MCP).                                                                                               | Owner           |
| Each chat belongs to exactly one inbox; a reply always leaves from the chat's inbox. The same customer writing to two numbers is two chats.                                                                   | My call         |
| Lite stays one inbox and its screens do not change; inbox UI shows only with more than one inbox (Enterprise). The inbox data model lives in the core (`@ezychat/*`) so the later Business API type plugs in. | My call         |
| The number the app links today becomes the first inbox on upgrade: no relink, no data move.                                                                                                                   | My call         |
| The inbox chip and filter show only when the user may open more than one inbox.                                                                                                                               | My call         |
| Each inbox has its own WhatsApp session (`wa-auth/<inbox>`), its own connection status and its own send queue; one phone offline does not stop the others.                                                    | My call         |

## Screens: what changes (review of every screen)

| Screen                                                                | Change                                                                                                                                                                                                                                                                                             | Mock        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Inbox list** (`/`)                                                  | Unified list of the inboxes the user may open; each row gets the **inbox chip** (name in its colour) after the customer name; an **Inbox filter** ("All inboxes (n)" / one inbox) above Mine/Unassigned/All. Hidden with one inbox. Search, tags, Mine/Unassigned work across the visible inboxes. | 01, 07      |
| **Conversation**                                                      | Header shows the inbox chip before the number ("Catering · +60…"): replies leave from that inbox.                                                                                                                                                                                                  | 02          |
| **No access**                                                         | An agent who opens a link to a chat of another inbox gets 404 from the server (nothing tells the chat exists); the mock shows "You cannot open this chat".                                                                                                                                         | 08          |
| **Admin → Inboxes** (new; in Enterprise it replaces Admin → WhatsApp) | One card per inbox: chip, number, "WhatsApp app (linked phone)", status (Connected / Waiting for the QR scan / Phone offline), who can open it, Edit, Remove.                                                                                                                                      | 03          |
| **Add inbox** (new)                                                   | Name, **Who can open it** (tick agents; admins always), Save, then the **QR code** with the phone steps (pairing code as today); the number comes from WhatsApp after the scan.                                                                                                                    | 04          |
| **Edit inbox**                                                        | Rename; tick or untick the agents who can open it (the same access as Members → Inbox access); **Link the phone again** shows the QR code (a new phone, or after "Phone offline").                                                                                                                 | 03 → Edit   |
| **Remove inbox**                                                      | Confirm; EzyChat unlinks the phone and stops sending and receiving for the number; its chats stay, read only, for admins.                                                                                                                                                                          | 03          |
| **Members**                                                           | New **Inbox access** column (phone: a line under the badges): admins "All inboxes (admin)"; agents their inbox chips + Edit → tick inboxes; "No inbox: this agent sees no chats" in the warning tone.                                                                                              | 05, 06      |
| **WhatsApp banner** (offline / relink notice in the inbox)            | Names the inbox that is offline ("Catering is offline"); only for inboxes the user may open.                                                                                                                                                                                                       | not in mock |
| **Customer panel / Notes**                                            | Per chat, so per inbox (no change). Open question 3.                                                                                                                                                                                                                                               | —           |
| **Group info**                                                        | As today, per inbox (a group belongs to the number that is in it).                                                                                                                                                                                                                                 | —           |
| **Assignment** (header dropdown)                                      | Only members who may open the chat's inbox are offered; assigning gives no extra access.                                                                                                                                                                                                           | not in mock |
| **Quick replies**                                                     | Shared by all inboxes (no change).                                                                                                                                                                                                                                                                 | —           |
| **AI Sales Agent**                                                    | Open question 2.                                                                                                                                                                                                                                                                                   | —           |
| **Setup wizard**                                                      | The WhatsApp step links the first inbox (as today). Lite unchanged.                                                                                                                                                                                                                                | not in mock |
| **Admin → WhatsApp**                                                  | Enterprise: part of Inboxes (one card per number, QR in Add/Edit). Lite keeps this page for its one number.                                                                                                                                                                                        | 03 (menu)   |
| **Phone access** (Cloudflare)                                         | No change.                                                                                                                                                                                                                                                                                         | —           |
| **Notifications** (push, in-app)                                      | Only for chats of inboxes the user may open.                                                                                                                                                                                                                                                       | —           |
| **Settings → Integrations (MCP)**                                     | A token sees only its owner's inboxes (admins: all); `send_message` replies from the chat's inbox; `send_to_new_number` needs an inbox choice.                                                                                                                                                     | —           |
| **Audit**                                                             | Inbox add/rename/remove, relinks, access changes; the inbox name on chat events.                                                                                                                                                                                                                   | —           |
| **Stats (MCP get_stats, Activity)**                                   | Per inbox and in total.                                                                                                                                                                                                                                                                            | —           |
| **Desktop status window**                                             | One status line per inbox (connected / waiting for the scan / phone offline) instead of one WhatsApp status.                                                                                                                                                                                       | —           |
| **Licence (Enterprise)**                                              | Open question 4.                                                                                                                                                                                                                                                                                   | —           |

## Open questions (for the owner)

1. **Groups:** each group stays in the inbox of the number that is in it (my suggestion). If two of your
   numbers are in the same group, it shows in both inboxes as two chats.
2. **AI Sales Agent:** one AI for every inbox, or switch it on per inbox?
3. **Same customer, two numbers:** two separate chats (my suggestion, simple and clear), or one shared
   customer profile across inboxes?
4. **Licence:** does the Enterprise SKU limit how many inboxes an install may have?

## Mock

- Runnable mock: `docs/features/multi-inbox/mock/` (README: run, walkthrough, checks). English only.
- Source: the latest owner-confirmed reference **token-permissions** at git revision
  `58346c1f0ba43e07575e35e4bf4e1dc44083c5c5`, cloned whole.
- Mock-only state: `src/mock/inboxes.ts` (inboxes, chat → inbox, member access) in the browser's
  localStorage (key `mock.multiInbox.v3`). The production feature keeps all of it on the server and filters
  there.
- Rounds: 1 showed only the Business API type (owner: the linked phone is missing); 2 had both types;
  3 (now) keeps only the linked phone. The removed Business API screens are in git history (round 2,
  revision `a70f414`).
- Changed: `AdminLayout.tsx`, `MembersPage.tsx`, `ChatList.tsx`, `ChatListItem.tsx`, `ChatFilters.tsx`,
  `ConversationHeader.tsx`, `Conversation.tsx` and the `admin`/`inbox` catalogs (en, ms, zh-CN; English
  text). Added: `admin/InboxesPage.tsx`, `admin/InboxAccess.tsx`, `inbox/InboxChip.tsx`,
  `inbox/useVisibleInboxes.ts`, `mock/inboxes.ts`.
- Screenshots (1280 px and 360 px): `mock/screenshots/01`–`08`. No page errors, no horizontal scroll.
- Retention: the oldest folder `customer-enrichment` was removed (last revision
  `6a3ccfc312525007dd22aa771f75ca3c6fb67071`, recorded in `mock-index.json`).
- Round 3 fix (owner: "on edit inbox connection it cant assign team member"): Add and Edit inbox now have
  **Who can open it**, with a tick box for each agent. Members → Inbox access stays as the second way in.
- **Confirmation: pending** (owner).

## Later: the WhatsApp Business API as a second inbox type

Agreed in the talk, out of this step: an inbox type for Meta's official Cloud API (no ban risk for an
unofficial client). Setup values: Phone number ID, WhatsApp Business Account ID, a permanent access token,
the app secret (stored encrypted, never shown again). Inbound by webhook only, through the customer's own
Cloudflare named tunnel (a relay only if customers prove they need it); every call signed with the app
secret. Free replies only within 24 hours after the customer's last message, then approved templates (Meta
charges). Moving an existing number from the phone to the API is a migration (Meta needs the number off the
WhatsApp app first). The round 2 mock (`a70f414`) shows the type choice, the Meta form, the webhook values,
the closed 24-hour window and the template dialog.
