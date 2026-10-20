# Several WhatsApp numbers (inboxes), connected through the WhatsApp Business API

Owner requests (2026-10-21): "for enterprise … whatsapp business API integration"; the main risk today is
that the linked phone "is not official and worry getting ban"; "lets stick business api first, but
considering future extension, now we want to allow support multiple number connection, do a mock design,
also review all screen how it affect inbox view and others, as simple admin will able to see all inbox,
and team member agent can assign to which inbox only, and the inbox should be unified view, only the user
have the inbox permission able to see the customer chat". Status: **mock waits for the owner**.

## Goal

An Enterprise team runs several WhatsApp numbers (for example the shop and Catering) in one EzyChat.
Each number is an **inbox** and connects through Meta's official **WhatsApp Business API** (Cloud API),
so there is no ban risk from an unofficial client. Admins see every inbox; an agent sees only the inboxes
an admin gave them. Everyone works in **one unified list**.

## Decisions

| Decision                                                                                                                                                                                                      | By                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Connection type: the WhatsApp Business API (Meta Cloud API) first; the linked phone (Baileys) stays possible later as a second type per inbox.                                                                | Owner                                                            |
| Several numbers: one inbox per number.                                                                                                                                                                        | Owner                                                            |
| Admins see all inboxes; an agent gets access to chosen inboxes only.                                                                                                                                          | Owner                                                            |
| One unified chat list of every inbox the user may open (not one page per number).                                                                                                                             | Owner                                                            |
| Only a user with access to the chat's inbox can see that chat (list, conversation, search, notifications, MCP).                                                                                               | Owner                                                            |
| Meta reaches EzyChat through the customer's own Cloudflare named tunnel (Phone access with their domain); a relay run by Anchor Sprint only if customers prove they need it.                                  | Owner ("start cloudflare first until proven need to have relay") |
| Each chat belongs to exactly one inbox; a reply always leaves from the chat's inbox. The same customer writing to two numbers is two chats.                                                                   | My call                                                          |
| Lite stays one inbox and its screens do not change; inbox UI shows only with more than one inbox (Enterprise). The inbox data model lives in the core (`@ezychat/*`), the Business API adapter in Enterprise. | My call                                                          |
| The inbox chip and filter show only when the user may open more than one inbox.                                                                                                                               | My call                                                          |

## How the Business API works (what the design must respect)

- **Setup values** (Meta for Developers → the app → WhatsApp): Phone number ID, WhatsApp Business Account
  ID, a permanent **access token** (system user), the **app secret**. Token and secret are secrets: stored
  encrypted (like the tunnel token), never shown again, never logged.
- **Inbound = webhook only.** Meta POSTs messages and status receipts to a public HTTPS **callback URL**;
  there is no polling. Meta first calls it with the admin's **verify token**; every later call is signed
  (`X-Hub-Signature-256`, HMAC-SHA256 with the app secret) and must be checked. If the URL is down, Meta
  retries for a limited time, then drops.
- **24-hour customer-service window.** Free-form replies only within 24 h after the customer's last message;
  outside it (and to message someone first) only an **approved template**. Meta charges per conversation.
- **Groups** are not like the linked phone (open question below).

## Screens: what changes (review of every screen)

| Screen                                                             | Change                                                                                                                                                                                                                                                                                             | Mock        |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Inbox list** (`/`)                                               | Unified list of the inboxes the user may open; each row gets the **inbox chip** (name in its colour) after the customer name; an **Inbox filter** ("All inboxes (n)" / one inbox) above Mine/Unassigned/All. Hidden with one inbox. Search, tags, Mine/Unassigned work across the visible inboxes. | 01, 08      |
| **Conversation**                                                   | Header shows the inbox chip before the number ("Kopi Apong · +60…"): replies leave from that inbox. When the 24-hour window is closed, the composer gives way to "The 24-hour reply window is closed" and **Send template**.                                                                       | 02          |
| **Template dialog** (new)                                          | Pick an approved template, fill its blanks, see the preview, send; the cost note. Templates come from Meta per WhatsApp Business Account.                                                                                                                                                          | 03          |
| **No access**                                                      | An agent who opens a link to a chat of another inbox gets 404 from the server (nothing tells the chat exists); the mock shows "You cannot open this chat".                                                                                                                                         | 09          |
| **Admin → Inboxes** (new, replaces Admin → WhatsApp in Enterprise) | One card per inbox: chip, number, "WhatsApp Business API", status (Connected / Waiting for Meta / Access token not accepted), who can open it, Edit, Remove; the "fixed public address" notice.                                                                                                    | 04          |
| **Add / Edit inbox** (new)                                         | Name, number, Phone number ID, Business Account ID, access token, app secret (kept when left empty on Edit); after Save the **webhook values for Meta**: callback URL + verify token with Copy, the steps, **Test connection**.                                                                    | 05          |
| **Remove inbox**                                                   | Confirm; EzyChat stops sending and receiving for the number; its chats stay, read only, for admins.                                                                                                                                                                                                | 04          |
| **Members**                                                        | New **Inbox access** column (phone: a line under the badges): admins "All inboxes (admin)"; agents their inbox chips + Edit → tick inboxes; "No inbox: this agent sees no chats" in the warning tone.                                                                                              | 06, 07      |
| **Customer panel / Notes**                                         | Per chat, so per inbox (no change). Open question: share one profile across inboxes for the same number?                                                                                                                                                                                           | —           |
| **Group info**                                                     | Linked-phone feature; see open questions.                                                                                                                                                                                                                                                          | —           |
| **Assignment** (header dropdown)                                   | Only members who may open the chat's inbox are offered; assigning gives no extra access.                                                                                                                                                                                                           | not in mock |
| **Quick replies**                                                  | Shared by all inboxes (no change).                                                                                                                                                                                                                                                                 | —           |
| **AI Sales Agent**                                                 | Open question: one agent for all inboxes, or on/off per inbox. The AI must respect the 24-hour window (no free reply outside it; hand over instead).                                                                                                                                               | —           |
| **Setup wizard**                                                   | Enterprise: step "WhatsApp" becomes "Add your first inbox" (the same form). Lite unchanged.                                                                                                                                                                                                        | not in mock |
| **Admin → WhatsApp** (linked phone)                                | Hidden in Enterprise while only Business API inboxes exist; comes back as an inbox type later.                                                                                                                                                                                                     | 04 (menu)   |
| **Phone access** (Cloudflare)                                      | Required for Business API inboxes: a named tunnel with the customer's domain; the Inboxes page warns when only a quick tunnel runs.                                                                                                                                                                | 04          |
| **Notifications** (push, in-app)                                   | Only for chats of inboxes the user may open.                                                                                                                                                                                                                                                       | —           |
| **Settings → Integrations (MCP)**                                  | A token sees only its owner's inboxes (admins: all); `send_message` replies from the chat's inbox; `send_to_new_number` needs an inbox choice and, on Business API, a template.                                                                                                                    | —           |
| **Audit**                                                          | Inbox add/edit/remove, access changes, template sends; the inbox name on chat events.                                                                                                                                                                                                              | —           |
| **Stats (MCP get_stats, Activity)**                                | Per inbox and in total.                                                                                                                                                                                                                                                                            | —           |
| **Desktop status window**                                          | One status line per inbox (connected / waiting for Meta) instead of one WhatsApp status.                                                                                                                                                                                                           | —           |
| **Licence (Enterprise)**                                           | Open question: does the SKU limit the number of inboxes?                                                                                                                                                                                                                                           | —           |

## Open questions (for the owner)

1. **Groups:** the Business API does not work like WhatsApp groups on a phone. Do Business API inboxes
   simply have no group chats (my suggestion), or do you need groups?
2. **AI Sales Agent:** one AI for every inbox, or switch it on per inbox?
3. **Same customer, two numbers:** two separate chats (my suggestion, simple and clear), or one shared
   customer profile across inboxes?
4. **Licence:** does the Enterprise SKU limit how many inboxes an install may have?
5. **Templates:** only send the approved templates from Meta (my suggestion), or also create and submit new
   templates from EzyChat?

## Mock

- Runnable mock: `docs/features/multi-inbox/mock/` (README: run, walkthrough, checks). English only.
- Source: the latest owner-confirmed reference **token-permissions** at git revision
  `58346c1f0ba43e07575e35e4bf4e1dc44083c5c5`, cloned whole.
- Mock-only state: `src/mock/inboxes.ts` (inboxes, chat → inbox, member access, closed windows) in the
  browser's localStorage. The production feature keeps all of it on the server and filters there.
- Changed: `AdminLayout.tsx`, `MembersPage.tsx`, `ChatList.tsx`, `ChatListItem.tsx`, `ChatFilters.tsx`,
  `ConversationHeader.tsx`, `Conversation.tsx` and the `admin`/`inbox` catalogs (en, ms, zh-CN; English
  text). Added: `admin/InboxesPage.tsx`, `admin/InboxAccess.tsx`, `inbox/InboxChip.tsx`,
  `inbox/WindowClosedBar.tsx`, `inbox/useVisibleInboxes.ts`, `mock/inboxes.ts`.
- Screenshots (1280 px and 360 px): `mock/screenshots/01`–`09`. No page errors, no horizontal scroll.
- Retention: the oldest folder `customer-enrichment` was removed (last revision
  `6a3ccfc312525007dd22aa771f75ca3c6fb67071`, recorded in `mock-index.json`).
- **Confirmation: pending** (owner).

## Not in this step

The linked phone as an inbox type and switching an inbox between types (after the Business API works);
a relay service; creating templates in EzyChat; media templates; per-inbox business hours.
