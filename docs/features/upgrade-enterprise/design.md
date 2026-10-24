# Upgrade to Enterprise links (Lite)

Owner request 2026-10-24 ("add upgrade enterprise, suggest where to put this, user click and go
https://ezychat.ai/#enterprise"). The owner chose all four suggested places: the AI agent limit, Admin →
WhatsApp, the account menu (admins) and the About dialog. Status: **confirmed** (see Confirmation).

## Decisions

| Topic        | Decision                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Target       | `https://ezychat.ai/#enterprise`, opened in a new tab (`target="_blank" rel="noopener noreferrer"`); the desktop app opens it in the system browser like every other outside link.                                                         |
| Edition      | Lite only. The address is a new `upgrade` entry in `AppLinks` (`LITE_APP_LINKS.upgrade`); Enterprise passes `upgrade: null` to `createInboxApp({ links })`, which hides every upgrade link. No edition check in the components.            |
| AI agents    | Admin → Members: a quiet note under the header, "Need more AI agents? EzyChat Enterprise has one AI agent for each WhatsApp number." with the button. The AI agent limit page (`/admin/members/ai/new` at the limit) shows the button too. |
| WhatsApp     | Admin → WhatsApp, inside the Connection card: "Need more WhatsApp numbers? EzyChat Enterprise links several numbers to one team inbox." with the button.                                                                                   |
| Account menu | "Upgrade to Enterprise" after Admin settings, **admins only** (agents cannot buy).                                                                                                                                                         |
| About dialog | "More WhatsApp numbers and AI agents, with support from Anchor Sprint." and the button, under View on GitHub; shown to everyone (it is product information).                                                                               |
| Look         | Outline button with a ✨ (`Sparkles`) icon and the outside-link icon, as the other outside links. No banners, no pop-ups, no badges: the links show only where the Lite limit is visible.                                                  |
| Not in scope | Prices, a trial or licence flow inside Lite, tracking of clicks (the website can count `#enterprise` visits).                                                                                                                              |

## Source baseline

- Feature **send-reactions**, path `docs/features/send-reactions/mock/`, `latestConfirmed` revision `82c8419`
  (the folder on main `eb6cc65` differs only in its notes).
- `reference.json` records the deltas; `snapshot.mjs --check` verifies the frozen app files and the inherited files.

Reused: `MembersPage` (limit hint position), the agent page limit `EmptyState`, `WhatsAppPage` Connection card,
`UserMenu` (outside-link menu items such as Request a feature), `AboutDialog` (View on GitHub button), the shadcn
`Button`, the mock-only edition switch (`mock/edition.ts`).

## Mock

- Run: `npx tsx --conditions=ezychat-source docs/features/upgrade-enterprise/mock/run.ts --fake-wa`, then
  `http://localhost:7485/?edition=lite` (API `7484`). Walkthrough: `mock/README.md`.
- The upgrade links show in the **Lite** mock view only (switch on Admin → Members or `?edition=lite`).
- Screenshots: `node docs/features/upgrade-enterprise/mock/upgrade-shots.mjs` (desktop 1280 / mobile 360,
  light / dark; Enterprise view and an agent's menu without links) into `mock/screenshots/`.

## Screen and state checklist

| Area           | Screen / state                                                 | Mock |
| -------------- | -------------------------------------------------------------- | ---- |
| Members (Lite) | Note with the button under the header; desktop and phone       | yes  |
| AI agent limit | Limit page: Upgrade to Enterprise beside Back to Members       | yes  |
| WhatsApp       | Note with the button in the Connection card; desktop and phone | yes  |
| Account menu   | Admin: menu item after Admin settings; agent: no item          | yes  |
| About          | Text and button under View on GitHub; phone sheet              | yes  |
| Enterprise     | No link on Members, the agent pages, the menu or About         | yes  |
| Dark theme     | All of the above                                               | yes  |

## Changed and added files (mock)

- Changed: `src/admin/AgentPage.tsx`, `src/admin/MembersPage.tsx`, `src/admin/WhatsAppPage.tsx`,
  `src/auth/UserMenu.tsx`, `src/components/app/AboutDialog.tsx`, `src/i18n/locales/{en,ms,zh-CN}/common.json`
  (`upgrade.*`, English in the mock).
- Added: `src/components/app/UpgradeEnterprise.tsx` (`useUpgradeUrl`, `UpgradeButton`, `UpgradeNote`),
  `upgrade-shots.mjs`.
- Runner: `run.ts` (ports 7485/7484, temp-folder prefix), shot scripts' default port.

## Implementation notes (for after confirmation)

- `apps/web/src/lib/links.ts`: `AppLinks.upgrade: string | null`, `LITE_APP_LINKS.upgrade =
'https://ezychat.ai/#enterprise'`; `UpgradeEnterprise.tsx` reads `useAppLinks().upgrade`.
- Real places: `AiMemberPage.tsx` limit page and `MembersPage.tsx` (Lite: `maxAgents <= 1`), `WhatsAppPage.tsx`,
  `auth/UserMenu.tsx`, `components/app/AboutDialog.tsx`. Texts translated to `ms` and `zh-CN`.
- Enterprise: pass `upgrade: null` (its `links`); check in the Enterprise repo that no link shows.
- Tests: component tests for Lite and `null`; e2e for the admin menu link and the About link (address and
  target); `npm run e2e:electron-links` covers the new outside link in the real desktop window.

## Retention

Adding this sixth feature folder removes the oldest by `creationOrder`, `docs/features/multi-inbox`
(creation order 6; clean and committed; last revision with the folder `eb6cc65`, recorded in `mock-index.json`).

## Confirmation

Confirmed by the owner 2026-10-24 after viewing the screenshots (Members note, AI agent limit, WhatsApp card,
account menu, About; desktop and phone): "Ok implement it". Status `confirmed` in `mock-index.json`; it is now
`latestConfirmed` (mock revision `2fce4a7`).
