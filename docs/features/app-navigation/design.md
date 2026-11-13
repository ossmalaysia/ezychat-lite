# App navigation: icon rail (desktop) and bottom tabs (phone)

**Owner request, 2026-11-13:** port the navigation idea of EzyChat Cloud, so people reach Reports, Ask Ezy and settings
directly, outside Admin.

- **Desktop (768 px and up):** a 64 px icon rail on every signed-in screen: Chats (unread count), Reports (admins),
  Ask Ezy, Members (admins); at the bottom Settings (admins; red dot when a WhatsApp number needs attention) and the
  account photo/menu. The admin pages keep their own side menu for the detail pages.
- **Phone (below 768 px):** fixed bottom tabs: admin Chats (count) · Reports · Ask Ezy · Settings; a team member who is
  not an admin Chats · Ask Ezy · Account. No tab bar inside an open chat. Ask Ezy opens its existing panel (full screen
  on phones).
- Lite has no Contacts page: no Contacts tab.

Status: **proposal, not confirmed.** Production UI work waits for the owner's confirmation of this mock.

## Mock and baseline

- Mock: [`mock/`](mock/README.md) (`npx tsx --conditions=ezychat-source docs/features/app-navigation/mock/run.ts
--fake-wa`, then `http://localhost:7489/`, `aisyah` / `daniel` / `ravi`, password `demo-pass-123`).
- Baseline: the owner-confirmed **forward-message** mock (`latestConfirmed` in `../mock-index.json`), git revision
  `2549b7afac813d8c2c957d15d653b2a150325866`, path `docs/features/forward-message/mock/`. Copied from `main` `bbe3c6e8`
  (only `reference.json` differs from `2549b7af`), without its screenshots. `snapshot.mjs --check` passes: 121 frozen
  files unchanged, 50 intentional deltas (10 in this proposal), 52 inherited baseline files unchanged (forward-message's
  own files added to the inherited list), 68 added files present.
- **Not** the baseline: `docs/features/mobile-redesign` (an unconfirmed proposal, creationOrder 39). Its phone list
  header (one 56 px bar with title, search and account; "Admin settings is in the account menu"; design-system rule
  "no bottom bar", 2026-11-07) **conflicts** with the bottom tabs. This mock replaces that part: on phones the account
  and Admin move to the tabs (Settings / Account), so the list bar keeps only the title and New chat. The rest of the
  mobile-redesign proposal (chips, number switcher sheet, FAB, swipe) is independent and can sit above the tabs (its
  FAB then sits above the tab bar, as in Cloud).
- Reference (read only): EzyChat Cloud `apps/customer/inbox/inbox-app.tsx` (`ez-rail`, `ez-tabs`) and
  `design-system/README.md` ("Desktop inbox (768 px and up)", "Phone (below 768 px)", rail 64, touch target 44, B125
  "at most 5 tabs"). The idea is ported, not Cloud's styles: Lite tokens (`bg-primary/10` selection, `bg-unread` count,
  `bg-danger` dot, `bg-surface` bars), lucide icons at stroke 1.75, `Button` / `Link` components.

### Source screens and components reused

| Real route / component (app and mock)                   | Use in this proposal                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`, `/chats/:jid` (`inbox/InboxPage.tsx`)              | Inside the shell; header loses the "Admin" button and the account photo (now in rail / tabs); version line desktop only                                      |
| `/admin/*` (`admin/AdminLayout.tsx`, `ADMIN_NAV`)       | Inside the shell; Reports and Members are rail places (full width, no side menu); the other pages keep a "Settings" side menu                                |
| `/admin/reports` (`ReportsPage`)                        | Rail and tab **Reports**                                                                                                                                     |
| `/admin/members`, `/admin/members/ai/:agentId`          | Rail **Members**; on phones a row of the Settings list                                                                                                       |
| `/admin/settings/*` (`SettingsPage`)                    | Side-menu item renamed **App settings** (so it does not repeat "Settings"); rail Settings opens it                                                           |
| `/admin/inboxes` (Lite `/admin/whatsapp`)               | Red dot in the side menu and the Settings list; the dotted rail Settings opens it                                                                            |
| `auth/UserMenu.tsx` (account menu)                      | Desktop: under the photo at the bottom of the rail (unchanged items incl. "Admin settings")                                                                  |
| `askezy/*` (app `apps/web/src/askezy`, main `bbe3c6e8`) | Copied into the mock (no `AskEzyButton`); opened by the rail and tab; mock stand-ins `/api/mock/ask-ezy` and `/api/mock/ask-ezy/status` answer from a script |
| `WaBanner` states, `useWaStatus`, mock inbox `status`   | Attention = WhatsApp `disconnected`/`qr`/`logged_out`/`replaced`/`blocked`, or a number not `connected`                                                      |
| `useChats` + ChatList's inbox / chosen-chat filter      | Chats count = open chats with unread messages the user may open                                                                                              |

### Files this proposal adds or changes in the mock

Added: `src/nav/AppNav.tsx` (shell, rail, tabs, badges), `src/nav/AccountPage.tsx` (`/account`), `src/nav/PhoneBar.tsx`
(phone app bar with back), `src/mock/appNav.ts` (Mock only attention switch, `?attention=1|0`),
`src/askezy/{AskEzyBlocks,AskEzyContext,AskEzyPanel}.tsx`, `src/askezy/api.ts` (copied; points at the stand-ins),
`src/auth/chat-scope.ts` (mock stand-in for the app's file), `ask-ezy.ts` (stand-in routes), `shots.mjs`.

Changed: `src/App.tsx` (shell route, `/account`, `AskEzyProvider`), `src/inbox/InboxPage.tsx`,
`src/admin/AdminLayout.tsx`, `src/index.css` (Ask Ezy dock rule from the app), `src/i18n/locales/{en,ms,zh-CN}/common.json`
(`appNav.*`), `src/i18n/locales/{en,ms,zh-CN}/inbox.json` (`askEzy.*` copied from the app), `proposal.ts`, `run.ts`
(temp-folder prefix, ready line), `seed.ts` (baseline drift fix: `new URL(...).pathname` gave `/D:/…` on Windows and the
runner stopped; now `fileURLToPath`), `README.md`, `reference.json`.

### Screen and state checklist (`screenshots/<shot>-<d1280|m360>-<light|dark>[-ms|-zh-CN].png`)

44 shots by `mock/shots.mjs`, 0 page errors, 0 horizontal overflow, rail only from 768 px, tabs only below, no tabs in
an open chat, every phone tab ≥ 44 px (`screenshots/results.json`).

| State                                           | Desktop 1280                                                                 | Phone 360                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Chats with the unread count (admin)             | `01-chats-unread` light, dark, ms, zh-CN                                     | same                                                        |
| Open chat (phone: no tab bar)                   | `02-chat-open` light, dark                                                   | same                                                        |
| Reports selected                                | `03-reports` light, dark                                                     | same                                                        |
| Ask Ezy open (docked / full screen)             | `04-ask-ezy` light, dark                                                     | same                                                        |
| Members                                         | `05-members`                                                                 | `05-members` (from Settings, back link)                     |
| Settings selected (side menu / App settings)    | `06-settings` light, ms, zh-CN                                               | `06-settings`                                               |
| Attention dot on Settings                       | `07-settings-attention`, `08-attention-numbers` (dot opens the numbers page) | `07-settings-attention`, `12-settings-home-*-ms` / `-zh-CN` |
| Account menu / Account page                     | `09-account-menu`                                                            | `13-account` (admin), `14-daniel-account` light, dark       |
| Team member (3 tabs; rail without admin places) | `10-daniel-chats`, `11-daniel-ask-ezy`                                       | `10-daniel-chats` light, dark, `11-daniel-ask-ezy`          |
| Agent limited to chosen chats (no Ask Ezy)      | `10-ravi-chats`                                                              | `10-ravi-chats` (2 tabs)                                    |
| Settings list (phone)                           | n/a (`/admin` opens App settings)                                            | `12-settings-home` light, dark, ms, zh-CN                   |

Not covered: Lite edition shots (works with `?edition=lite`: WhatsApp instead of Inboxes), tablet widths between 768 and
1279 px (rail + Ask Ezy as an overlay), keyboard focus order screenshots.

### Five-folder retention

`app-navigation` is the sixth feature folder. The oldest by creation order, **new-chat** (37), is removed; its last
revision on `main` is `98b22a044a6ce1d805d0fc5fb38c5e44a3838716` (recorded in its archived index entry). Kept:
cloud-auth-storage (design only, 2026-11-08), forward-message (the confirmed baseline), mcp-file-upload,
mobile-redesign, app-navigation; `template-store` stays (live tooling, not counted).

## Behaviour

**Rail (desktop, 768 px and up).** 64 px, app background, right border, on every signed-in page (inbox, admin,
account). Items: icon (20 px) in a 48 × 32 pill (56 × 32 in the tabs) with a 12 px label under it, the whole 64 × 56 cell is the hit area.
Selected: `bg-primary/10` pill, `text-primary` label, `aria-current="page"`. Order: **Chats** (count badge), **Reports**
(admins), **Ask Ezy** (toggle, `aria-pressed`), **Members** (admins); bottom: **Settings** (admins; red dot) and the
account photo (account menu). No logo in the rail (the list says "Inbox"). Settings opens App settings; with the dot it
opens the numbers page (Cloud does the same: the broken number first).

**Tabs (phone, below 768 px).** One row at the bottom, `bg-surface`, top border, safe area below; equal-width cells,
56 px high. Admin: **Chats · Reports · Ask Ezy · Settings**. Team member: **Chats · Ask Ezy · Account**. Hidden inside
an open chat (`/chats/:jid`): the composer owns the bottom. Ask Ezy opens the panel full screen over the tabs.
Settings is current on every admin page except Reports, and on the admin's Account page.

**Settings on phones** (`/admin`): a list page with groups Team (Members, Quick replies), Business (Inboxes or WhatsApp
with "Needs attention", Connectors, Phone access), App (App settings, Audit) and Your account (→ `/account`). Each
admin page then has a 56 px app bar with a back arrow to the Settings list (agent pages back to Members, a connector's
page back to Connectors). This replaces the old phone admin bar ("‹ Inbox", "Admin · Section", ☰ sheet).

**Account page** (`/account`): photo, name, role; Appearance, Language, Notifications; Change password, (Upgrade for
Lite admins), Share this app, Send feedback, About; Sign out; version. Same items as the account menu.

**Counts and dots.** Chats count = open chats with unread messages the user may open (all their inboxes; chosen chats
for a limited agent), "99+" above 99, accessible name "Chats, 10 chats with unread messages". Red dot = a number needs
an admin; only admins see it; accessible name "Settings, A WhatsApp number needs attention".

**Ask Ezy.** The existing panel and rules: docked beside the page from 1280 px (the page makes room), an overlay sheet
below 1280 px, full screen on phones; hidden for an agent limited to chosen chats (the server refuses them anyway).
The rail/tab button toggles it and shows it as pressed while open.

**Editions.** Enterprise uses the same `@ezychat/web` shell. Its extension admin nav links (`WebExtension.adminNav`,
absolute `/admin/ext/<name>/…` paths, with `useBadge`) must stay reachable: they join the Settings side menu on desktop
and a group in the phone Settings list; a badge or attention dot there should also raise the Settings dot. Extension
routes at `/ext/<name>/…` render inside the shell (rail / tabs). The Enterprise lock screen (`lockScreen`) stays a full
page without rail or tabs. An extension may not add a rail item or a tab (the five-tab limit); a later extension point
could, with the owner's decision.

## Implementation notes (for the production PR)

- New `components/app/AppShell` (rail + `Outlet` + tabs + Ask Ezy panel) as a layout route around `/`, `/chats/:jid`,
  `/account`, `/admin/*` and extension routes; `InboxPage` and `AdminLayout` change from `h-dvh` / `min-h-dvh` to
  filling the shell. The admin phone menu sheet and "Back to inbox" go away.
- Unread count: the mock sums the loaded chat list pages; production needs one server count (e.g. a field on the chat
  list answer or `GET /api/chats/unread-count`, kept live by the existing chat socket events), or the count is wrong
  past the first page.
- `docs/design-system.md` needs the new pattern (draft below) and changes to "Bottom navigation vs menu" and "App bar
  and number switcher" (the 2026-11-07 "no bottom bar" rule is reversed by this request).
- e2e: many specs click "Admin" in the list header or "Back to inbox"; they move to the rail/tab Settings and Chats.

### Draft design-system entry (add to `docs/design-system.md` when confirmed)

> ### App navigation
>
> - **Do** show one app navigation on every signed-in page: from 768 px a 64 px icon rail on the left (Chats with the
>   count of chats with unread messages, Reports, Ask Ezy, Members; Settings and the account photo at the bottom),
>   below 768 px bottom tabs (admins: Chats · Reports · Ask Ezy · Settings; team members: Chats · Ask Ezy · Account).
>   Icon 20 px in a 48 × 32 pill (56 × 32 in the tabs; `bg-primary/10 text-primary` when current) with a 12 px label; the whole cell is the
>   hit area (≥ 56 px). Count: `bg-unread` pill, "99+" cap. Attention: a 10 px `bg-danger` dot on Settings, admins
>   only, with an accessible name. — app-navigation `01-chats-unread`, `07-settings-attention`, `12-settings-home`
> - **Do** hide the tabs inside an open chat and keep admin detail pages under Settings (side menu on desktop, a list
>   page on phones, a back arrow in the 56 px app bar).
> - **Don't** add a sixth tab, put a rarely used page in the tabs, show the rail on phones or the tabs on desktop, add
>   an "Admin" button to the list header, or use the dot for anything but a number that needs an admin.

## Open questions for the owner

1. **Members on phones:** a row in the Settings list (mocked) or a fifth tab (Chats · Reports · Ask Ezy · Members ·
   Settings, Cloud keeps Team under Settings)? Proposed: under Settings.
2. **Settings for a team member:** they have no admin pages, so the mock shows **Account** (the account menu as a page)
   instead of Settings. Alternatively name it "Settings" with only personal settings. Proposed: Account.
3. **Agent limited to chosen chats:** no Ask Ezy, so only two tabs (Chats · Account). Keep the two-tab bar (mocked) or
   drop the bar and keep the account photo in the list header for them?
4. **Label "Chats" vs page title "Inbox":** the tab says Chats (as requested), the list header says Inbox. Rename the
   header to "Chats", or the tab to "Inbox"?
5. **Rail Settings target:** App settings (mocked; with the dot: the numbers page), or the last Settings page visited?
6. **Desktop rail while Ask Ezy is open:** Ask Ezy shows as pressed and the page item stays current (both
   highlighted, as in Cloud). OK, or highlight only Ask Ezy?
7. **Report a problem:** Cloud has a rail item for it. Lite keeps Send feedback in the account menu / Account page
   (mocked). Add a rail item?
8. **mobile-redesign:** confirm that its phone list header and "no bottom bar" rule are replaced by this proposal.

## Confirmation

Owner (Jazz) confirmed the mock on 2026-11-13 ("other also fine", then "design good, go ahead") from the review page with
the key screenshots, mock revision `dc0d5ce640bd06322a86a423a25c88f3f54e58f8`, with the recommended answers to the open questions:

1. Members on the phone: a row in Settings, not a fifth tab.
2. Report a problem: stays in the account menu (no rail item).
3. The list title is renamed from "Inbox" to "Chats" to match the tab (implementation; the mock still says Inbox).
4. Rail Settings opens App settings, or the WhatsApp numbers page when a number needs attention.

Build after PR #365 (owner, 2026-11-13). Add the "App navigation" entry to `docs/design-system.md` in the same PR.
