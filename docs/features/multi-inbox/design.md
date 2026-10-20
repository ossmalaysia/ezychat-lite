# Several WhatsApp numbers (inboxes): the WhatsApp app or the WhatsApp Business API

Owner requests (2026-10-21): "for enterprise … whatsapp business API integration"; the main risk today is
that the linked phone "is not official and worry getting ban"; "can we do backward to design multi number
case with bailey first? than we allow each number or instance to connect via whatsapp business api or go
back to bailey"; "lets stick business api first, but considering future extension, now we want to allow
support multiple number connection, do a mock design, also review all screen how it affect inbox view and
others, as simple admin will able to see all inbox, and team member agent can assign to which inbox only,
and the inbox should be unified view, only the user have the inbox permission able to see the customer
chat"; on the first mock: "how come inboxes missing personal whatsapp connect? it is remove? we should not
do whatsapp business api first". Status: **mock round 2 waits for the owner**.

## Goal

A team runs several WhatsApp numbers (for example the shop and Catering) in one EzyChat. Each number is an
**inbox**, connected in one of two ways: the **WhatsApp app on a phone** (QR scan, as the app works today)
or Meta's official **WhatsApp Business API** (Cloud API, no ban risk for an unofficial client). Admins see
every inbox; an agent sees only the inboxes an admin gave them. Everyone works in **one unified list**.

## Decisions

| Decision                                                                                                                                                                                                                                                | By                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Two connection types per inbox: the WhatsApp app (linked phone, Baileys, as today) and the WhatsApp Business API (Meta Cloud API). The linked phone stays.                                                                                              | Owner (round 2)                                                  |
| Order of the work: several numbers with the linked phone first; the Business API type second.                                                                                                                                                           | Owner ("multi number case with bailey first"; round 2)           |
| Several numbers: one inbox per number.                                                                                                                                                                                                                  | Owner                                                            |
| Admins see all inboxes; an agent gets access to chosen inboxes only.                                                                                                                                                                                    | Owner                                                            |
| One unified chat list of every inbox the user may open (not one page per number).                                                                                                                                                                       | Owner                                                            |
| Only a user with access to the chat's inbox can see that chat (list, conversation, search, notifications, MCP).                                                                                                                                         | Owner                                                            |
| Business API: Meta reaches EzyChat through the customer's own Cloudflare named tunnel (Phone access with their domain); a relay run by Anchor Sprint only if customers prove they need it.                                                              | Owner ("start cloudflare first until proven need to have relay") |
| Each chat belongs to exactly one inbox; a reply always leaves from the chat's inbox. The same customer writing to two numbers is two chats.                                                                                                             | My call                                                          |
| Lite stays one inbox (a linked phone) and its screens do not change; inbox UI shows only with more than one inbox (Enterprise). The inbox data model and the linked-phone type live in the core (`@ezychat/*`); the Business API adapter in Enterprise. | My call                                                          |
| The number the app links today becomes the first inbox (a linked phone) on upgrade: no relink, no data move.                                                                                                                                            | My call                                                          |
| The inbox chip and filter show only when the user may open more than one inbox.                                                                                                                                                                         | My call                                                          |
| The 24-hour window and templates apply only to Business API inboxes.                                                                                                                                                                                    | Meta's rule                                                      |

## The two connection types

|                | WhatsApp app (linked phone)                                                       | WhatsApp Business API                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup          | Name, then scan a QR code (or pairing code) on the phone, as today                | Meta app: Phone number ID, WhatsApp Business Account ID, a permanent access token (system user), the app secret; then the webhook in Meta                                                                   |
| Inbound        | The linked socket (Baileys), as today                                             | Webhook only: Meta POSTs to a public HTTPS callback URL; the first call carries the admin's verify token; every call is signed (`X-Hub-Signature-256`, HMAC-SHA256 with the app secret) and must be checked |
| Public address | Not needed                                                                        | Needed: Phone access with the customer's own domain (a quick tunnel address changes)                                                                                                                        |
| Replies        | Any time                                                                          | Free only within 24 h after the customer's last message; then only approved templates (Meta charges per conversation)                                                                                       |
| Groups         | As today                                                                          | Not like a phone (open question 1)                                                                                                                                                                          |
| Ban risk       | Not official: WhatsApp can ban a number that messages many people who did not ask | Official                                                                                                                                                                                                    |
| Secrets        | WhatsApp session in `wa-auth/<inbox>`                                             | Token and secret stored encrypted (like the tunnel token), never shown again, never logged                                                                                                                  |

## Screens: what changes (review of every screen)

| Screen                                                                | Change                                                                                                                                                                                                                                                                                                                            | Mock         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Inbox list** (`/`)                                                  | Unified list of the inboxes the user may open; each row gets the **inbox chip** (name in its colour) after the customer name; an **Inbox filter** ("All inboxes (n)" / one inbox) above Mine/Unassigned/All. Hidden with one inbox. Search, tags, Mine/Unassigned work across the visible inboxes.                                | 01, 09       |
| **Conversation**                                                      | Header shows the inbox chip before the number ("Catering · +60…"): replies leave from that inbox. In a Business API inbox with a closed 24-hour window, the composer gives way to "The 24-hour reply window is closed" and **Send template**; a linked-phone inbox always has the normal composer.                                | 02           |
| **Template dialog** (new, Business API)                               | Pick an approved template, fill its blanks, see the preview, send; the cost note. Templates come from Meta per WhatsApp Business Account.                                                                                                                                                                                         | 03           |
| **No access**                                                         | An agent who opens a link to a chat of another inbox gets 404 from the server (nothing tells the chat exists); the mock shows "You cannot open this chat".                                                                                                                                                                        | 10           |
| **Admin → Inboxes** (new; in Enterprise it replaces Admin → WhatsApp) | One card per inbox: chip, number, type ("WhatsApp app (linked phone)" / "WhatsApp Business API (official)"), status (Connected / Waiting for the QR scan / Phone offline / Waiting for Meta / Access token not accepted), who can open it, Edit, Remove; the "fixed public address" notice only when a Business API inbox exists. | 04           |
| **Add inbox: type** (new)                                             | First step: **WhatsApp app (linked phone)** (quick, free, not official, ban risk) or **WhatsApp Business API (official)** (Meta app, token, fixed address, 24-hour rule, templates charged).                                                                                                                                      | 05           |
| **Add / Edit: linked phone**                                          | Name, Save, then the **QR code** with the phone steps (pairing code as today); the number comes from WhatsApp after the scan. Edit shows the QR again to relink.                                                                                                                                                                  | 06 (phone)   |
| **Add / Edit: Business API**                                          | Name, number, Phone number ID, Business Account ID, access token, app secret (kept when left empty on Edit); after Save the **webhook values for Meta**: callback URL + verify token with Copy, the steps, **Test connection**.                                                                                                   | 06 (desktop) |
| **Remove inbox**                                                      | Confirm; EzyChat unlinks the phone or stops the API for the number; its chats stay, read only, for admins.                                                                                                                                                                                                                        | 04           |
| **Members**                                                           | New **Inbox access** column (phone: a line under the badges): admins "All inboxes (admin)"; agents their inbox chips + Edit → tick inboxes; "No inbox: this agent sees no chats" in the warning tone.                                                                                                                             | 07, 08       |
| **Customer panel / Notes**                                            | Per chat, so per inbox (no change). Open question 3.                                                                                                                                                                                                                                                                              | —            |
| **Group info**                                                        | Linked-phone inboxes keep groups (as today); Business API inboxes: open question 1.                                                                                                                                                                                                                                               | —            |
| **Assignment** (header dropdown)                                      | Only members who may open the chat's inbox are offered; assigning gives no extra access.                                                                                                                                                                                                                                          | not in mock  |
| **Quick replies**                                                     | Shared by all inboxes (no change).                                                                                                                                                                                                                                                                                                | —            |
| **AI Sales Agent**                                                    | Open question 2. In a Business API inbox the AI must respect the 24-hour window (no free reply outside it; hand over instead).                                                                                                                                                                                                    | —            |
| **Setup wizard**                                                      | The WhatsApp step links the first inbox (a linked phone, as today). Lite unchanged.                                                                                                                                                                                                                                               | not in mock  |
| **Admin → WhatsApp**                                                  | Enterprise: part of Inboxes (one linked-phone inbox per number, QR in Add/Edit). Lite keeps this page for its one number.                                                                                                                                                                                                         | 04 (menu)    |
| **Phone access** (Cloudflare)                                         | Required only for Business API inboxes: a named tunnel with the customer's domain; the Inboxes page warns when only a quick tunnel runs.                                                                                                                                                                                          | 04           |
| **Notifications** (push, in-app)                                      | Only for chats of inboxes the user may open.                                                                                                                                                                                                                                                                                      | —            |
| **Settings → Integrations (MCP)**                                     | A token sees only its owner's inboxes (admins: all); `send_message` replies from the chat's inbox; `send_to_new_number` needs an inbox choice and, on Business API, a template.                                                                                                                                                   | —            |
| **Audit**                                                             | Inbox add/edit/remove, relinks, access changes, template sends; the inbox name on chat events.                                                                                                                                                                                                                                    | —            |
| **Stats (MCP get_stats, Activity)**                                   | Per inbox and in total.                                                                                                                                                                                                                                                                                                           | —            |
| **Desktop status window**                                             | One status line per inbox (connected / waiting for the scan / phone offline / waiting for Meta) instead of one WhatsApp status.                                                                                                                                                                                                   | —            |
| **Licence (Enterprise)**                                              | Open question 4.                                                                                                                                                                                                                                                                                                                  | —            |

## Open questions (for the owner)

1. **Groups:** linked-phone inboxes keep their groups. The Business API does not work like groups on a
   phone: do Business API inboxes simply have no group chats (my suggestion)?
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
- Mock-only state: `src/mock/inboxes.ts` (inboxes and their type, chat → inbox, member access, closed
  windows) in the browser's localStorage. The production feature keeps all of it on the server and filters
  there.
- Round 2: Add inbox starts with the type; the seeded "Kopi Apong" is a linked phone, "Catering" a Business
  API inbox; the closed-window demo moved to Nurul Huda (Catering).
- Changed: `AdminLayout.tsx`, `MembersPage.tsx`, `ChatList.tsx`, `ChatListItem.tsx`, `ChatFilters.tsx`,
  `ConversationHeader.tsx`, `Conversation.tsx` and the `admin`/`inbox` catalogs (en, ms, zh-CN; English
  text). Added: `admin/InboxesPage.tsx`, `admin/InboxAccess.tsx`, `inbox/InboxChip.tsx`,
  `inbox/WindowClosedBar.tsx`, `inbox/useVisibleInboxes.ts`, `mock/inboxes.ts`.
- Screenshots (1280 px and 360 px): `mock/screenshots/01`–`10`. No page errors, no horizontal scroll.
- Retention: the oldest folder `customer-enrichment` was removed (last revision
  `6a3ccfc312525007dd22aa771f75ca3c6fb67071`, recorded in `mock-index.json`).
- **Confirmation: pending** (owner).

## Not in this step

Switching an existing inbox from the linked phone to the Business API (Meta requires the number to leave the
WhatsApp app first: a migration step); a relay service; creating templates in EzyChat; media templates;
per-inbox business hours.
