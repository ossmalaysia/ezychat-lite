# WhatsApp Safety: warnings, locked files, report and block

Status: **confirmed** 2026-10-31 (see Confirmation). Branch `claude/funny-curie-wawto4`. Mock:
[mock/index.html](mock/index.html), run instructions and walkthrough in [mock/README.md](mock/README.md).

## Owner request (2026-10-31)

People fear ZIP files and scam messages arriving on WhatsApp. Add a simple safety module that checks incoming files and
messages, flags suspicious ones, lets an admin see **which number sent what and who on the team touched it**, and block
or report the number. Offer it in Lite and Enterprise to protect the business.

Background: since June 2026 a campaign spreads VBScript in ZIP files dressed as statements of account through
**hacked real WhatsApp accounts**, Malaysia most affected (Kaspersky GReAT, MyCERT alert); September 2026 reports of
"forward this statement of account to your finance manager, open it on a laptop".

## Decisions (owner, in chat 2026-10-31)

1. Start simple: warnings + an admin Safety report. **AI scoring is in Lite** (uses the install's own AI connection).
2. Blocking: if the connection's API offers it, treat it as working (Baileys `updateBlockStatus`, Business API
   `block_users`). Recorded here so later agents do not re-open it; Baileys blocking is still smoke-tested once on a
   spare number before release.
3. Report to WhatsApp is not possible through any API. "Report" in EzyChat = scam mark for the team + block where the
   connection allows + steps for the phone (linked-phone inboxes) + NSRC 997 / Cyber999.
4. Business API inboxes block from anywhere (remote access included) within 24 h of the number's last message.
5. Writing rule for every screen (added to `docs/design-system.md` "Writing" and AGENTS.md): for a business owner, few
   plain words, an `InfoTip` for anything technical.

## How it works

```
message stored
  ① Rules (always, local, synchronous, a few ms)  → signals, score, rule level
       no signal → done (no AI call, no cost)
  ② AI check (switch on + AI connected; fast model; after the message is stored)
       sees: message text, file name and type, the ZIP's file list, "new number / customer since / first file"
       never: the file's content
       answers: { level: none|warning|high, category, reason }
  ③ Combine → final level → ④ action
```

**Rules** (`safety/rules.ts`; reads the first bytes for the real type and only the ZIP's central directory — never
runs, opens or extracts a file; size and entry caps, one ZIP level, own small parser in a worker with a timeout):

| Signal                                                                                                | Points   |
| ----------------------------------------------------------------------------------------------------- | -------- |
| Program or script (`.exe .msi .scr .vbs .js .bat .ps1 .lnk .hta .apk .jar .iso`), by content not name | Critical |
| Such a file inside a ZIP                                                                              | Critical |
| Fake double extension (`Statement.pdf.vbs`) or right-to-left name trick                               | Critical |
| Number already reported as scam by the team                                                           | Critical |
| Locked or uninspectable archive (password ZIP, RAR, 7z)                                               | 40       |
| Macro Office file (`.docm .xlsm`)                                                                     | 40       |
| Password in the message                                                                               | 25       |
| "Open on a laptop / desktop"                                                                          | 25       |
| Short link, lookalike / punycode domain, IP link                                                      | 25       |
| Finance urgency ("statement of account", "forward to finance", "urgent payment"; EN, BM, 中文)        | 20       |
| First file from this number                                                                           | 15       |

Rule level: Critical → High; ≥ 60 → High; 30–59 → Warning; < 30 → none.

**Combine** (`decide()` in the mock is the policy): the AI may raise a level or confirm it, and may lower **only a
rules-only Warning** to none (a customer asking about their own payment). It never lowers a Critical or High rule
result: message text cannot talk its way past the rules. AI off or unavailable → the rule result stands. Cost cap per
inbox per day; logs carry level, category and ms only, never text.

**Actions**

| Final level | Chat                                       | Download                                                                  | Admin               |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------------- | ------------------- |
| Warning     | Yellow banner with up to two plain reasons | Confirm dialog, recorded                                                  | Listed in Safety    |
| High        | Red banner                                 | **Locked for agents** (refusal recorded); admins download after a warning | Push alert + Safety |

- The AI agent does not answer a chat whose latest inbound message is High; it hands over.
- **Auto-block** (admin switch, **off** by default): only when the level comes from a **Critical rule** and the number is
  **not an existing customer** (no team reply, no saved profile, chat < 7 days). An existing customer sending a Critical
  file is most likely hacked: file locked, bar "This customer's WhatsApp may be hacked" with **Copy warning**, never
  blocked. AI-only High never auto-blocks. Every block has Unblock and an audit row with the rule.
- **Mark safe** (optionally "trust this sender for this kind of message") stops repeat alerts (an accountant's monthly
  ZIP).
- **Report as scam**: scam mark shown in every inbox (shared like `contacts`), optional block, phone steps (linked
  phone) or "Business API numbers can't report to WhatsApp", NSRC 997, Cyber999.

**Locked files (quarantine)**: High files are stored under `<data>/quarantine/<chat folder>/<message id>.bin` (no real
extension or name, so nothing can run them); the original name stays in the database. Served only through the media
route after the lock check (agents 403, admins with the warning, original name, `attachment` + sandbox CSP as today).
Not in nightly backups. Auto-deleted after 30 days (7 / 30 / 90). Release keeps the file there; Delete removes it and
the message keeps "File deleted by …". Defender removing it first shows "Removed by antivirus". Not encrypted, so the OS
antivirus still sees it.

**Blocking per connection** (`WaAdapter.blockNumber/unblockNumber/listBlocked`, capability `block` with an optional
window, read only through capabilities):

|                        | Linked phone (Baileys)                | Business API (Enterprise `wa-cloud`)                                                                                                           |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Block / unblock / list | `updateBlockStatus`, `fetchBlocklist` | `POST/DELETE/GET /{phone-number-id}/block_users`                                                                                               |
| When                   | any time                              | within 24 h of the number's last message (`chats.last_inbound_at`); after that Block is greyed with the reason and the scam mark still applies |
| Limits                 | none known                            | 64,000 per account; per-number errors (139100 partial, 139101 full, 130429 rate)                                                               |

Lite ships the core contract and the Baileys implementation; Enterprise implements it in `wa-cloud` after the Lite
release (no core patch).

## Lite and Enterprise

|                                                                                                             | Lite | Enterprise |
| ----------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| Rules, banners, download check, locked files, Safety page, mark safe, report, manual block                  | ✓    | ✓          |
| AI check (own AI connection, fast model)                                                                    | ✓    | ✓          |
| Auto-block on Critical rules                                                                                | ✓    | ✓          |
| Check files and links online (VirusTotal hash with a paid key, Google Web Risk; hash only by default, PDPA) | —    | ✓          |
| Business API blocking (`wa-cloud`)                                                                          | —    | ✓          |

## What changes on screen

- **Chat bubble**: banner (title, ≤ 2 reasons, the AI's one line); the file as "Tap to check before download" (Warning),
  "Locked for your team. Tap to check." (High, admin) or a lock "Locked for safety. Ask an admin." (High, agent);
  download dialog; "File deleted by …".
- **Chat bar**: "Blocked automatically by WhatsApp Safety." / "Blocked by {name}." with Unblock (admins), "Your team
  reported this number as a scam.", or the hacked-customer bar with Copy warning.
- **Admin → Safety** (nav after Reports; admins, every inbox): counts (To review, Files locked, Numbers blocked); tabs
  Flagged (To review / All; rows: level, name, time, number · new or existing customer, file or text, main reason,
  status, Auto-blocked, Customer may be hacked, File locked, Downloaded by …), Blocked (Unblock), Settings.
- **Item sheet**: what they sent (+ files inside the ZIP, file state), why (each rule, AI check), your team (downloads,
  refused tries), history; actions Mark safe (+ trust), Report as scam, Block / Unblock, Unlock file for team, Delete
  file, Open chat.
- **Report dialog**: scam mark, Block the number, Tell WhatsApp too (tip with three phone steps), NSRC 997, Cyber999.
- **Settings**: Check incoming messages (on), AI check (on when an AI is connected; tip), Auto-block new numbers (off;
  tip), Delete locked files after 7/30/90 days (tip), Check files and links online (Enterprise).
- **Admin → Reports → WhatsApp Safety** (owner request 2026-10-31, same 7 / 30 / 90 days, admins, every inbox):
  - Tiles: **Dangerous files** (programs and locked files received), **Scam messages** (fake links, payment tricks),
    **Risky downloads** (High-risk files the team downloaded; danger tone above 0; hint = downloads stopped by the
    lock), **Numbers blocked** (hint: how many automatically), **Customers maybe hacked** (known customers who sent a
    dangerous file; warning tone), **False alarms** (% of flagged marked safe or cleared by AI: tells the admin
    whether the checks are too strict). Counts carry "vs previous N days" like the other tiles.
  - Charts: **Flagged messages per day** (stacked High / Check, Show as table), **What was caught** (ranked kinds:
    program hidden in a file, fake bank or login link, payment or finance trick, locked file with a password, file
    with macros), **Who opened risky files** (teammate, risky downloads, stopped by lock), **Numbers that sent the
    most** (name, number, flagged, status Blocked / Reported / May be hacked / To review).
  - Off: one line "WhatsApp Safety is off, so nothing was checked." Link **Open Safety** to Admin → Safety.
  - Not shown (decided): median time to review (little use for a small team), per-inbox split (the Inbox filter of
    Reports applies once multi-inbox reports exist), money lost (the app cannot know it).
- Mock only (dashed box): simulate each demo message arriving; the toast stands in for the admin push alert.

## Baseline

- Cloned from the owner-confirmed **ai-handoff-rules** mock (`latestConfirmed`, revision
  `16a126ec521e9e9e79dbe4a4477c449114bb51fb`) with `git archive`; its folder on main `8bfeef9` differs only in
  `design.md`. Screenshots not copied (git history keeps them).
- Gap: the confirmed **ai-direct-chats** card (merged on main) is not in this baseline, which was cloned from
  `latestConfirmed`; it touches only the agent page, not these screens.
- Reused: MediaView document card, ReplyWindow-style chat bar, ConfirmDialog, Sheet, SegmentedControl, Tabs,
  `InfoTip` (concept-tips), the Groups card switch row, Reports' page header and stat layout, the Mock only box.
- Retention: sixth feature folder; the oldest, `grammar-fix` (confirmed revision in the mock index), is pruned in the
  same change (git history keeps it).

## Changed files (mock)

- Changed: `src/admin/AdminLayout.tsx` (nav + route), `src/inbox/MessageBubble.tsx` (banner, checked file),
  `src/inbox/Conversation.tsx` (chat bar), `src/lib/tips.ts` (four tips),
  `src/i18n/locales/{en,ms,zh-CN}/{admin,inbox,common}.json` (`mockSafety.*`, `mockTips.*`).
- Added: `src/admin/SafetyPage.tsx`, `src/admin/SafetyReport.tsx` (Reports section), `src/inbox/SafetyMessage.tsx`,
  `src/mock/safety.ts`. Changed for Reports: `src/admin/ReportsPage.tsx`.
- Runner: `safety.ts` (scenarios, `decide()`, routes `/api/mock/safety*`), `run.ts` (registers and seeds it, temp
  folder, ready line), `safety-shots.mjs` (added), shot-script usage paths, `reference.json`
  (`snapshot.mjs --check` passes: 211 inherited files unchanged, 14 changed, 4 added).

## Screen checklist

| State                                                                           | Desktop 1280 | Mobile 360 | Light | Dark |
| ------------------------------------------------------------------------------- | ------------ | ---------- | ----- | ---- |
| Safety list (to review) with number, customer/new, downloads                    | ✓            | ✓          | ✓     | ✓    |
| All, incl. cleared by AI                                                        | ✓            | ✓          | ✓     | ✓    |
| Item sheet (ZIP lure: inside list, AI, refused download)                        | ✓            | ✓          | ✓     | ✓    |
| Item sheet (hacked customer note)                                               | ✓            | ✓          | ✓     | ✓    |
| Report dialog                                                                   | ✓            | ✓          | ✓     | ✓    |
| Settings                                                                        | ✓            | ✓          | ✓     | ✓    |
| Chat: High file, admin + download dialog                                        | ✓            | ✓          | ✓     | ✓    |
| Chat: High file locked for agent, refusal toast                                 | ✓            | ✓          | ✓     | ✓    |
| Chat: fake bank link (text), macro file (Warning)                               | ✓            | ✓          | ✓     | ✓    |
| Chat: hacked-customer bar                                                       | ✓            | ✓          | ✓     | ✓    |
| Auto-block on: new number blocked, known customer not; Blocked tab; blocked bar | ✓            | —          | ✓     | —    |
| Reports → WhatsApp Safety (tiles, per day, kinds, team, senders)                | ✓            | ✓          | ✓     | ✓    |

`safety-shots.mjs`: 54 shots, 0 problems (no page errors, no horizontal overflow).

## Production plan (after confirmation)

1. Shared: zod `SafetyFlag` on `Message`, `SafetyItem`, settings; migration `safety_items`, `safety_numbers` (scam /
   trusted), `safety_downloads`; settings keys `safety_enabled`, `safety_ai`, `safety_auto_block`,
   `safety_delete_after_days`.
2. Server: `safety/rules.ts` (+ ZIP directory reader in a worker), `safety/ai-check.ts` (structured `draft`-style call on
   the fast model, fixed rules first, message as data), `safety/service.ts` (combine, quarantine move, auto-block, push
   `safety:high` to admins, audit), media route lock check, routes `/api/safety*`, AI agent hand-over on High,
   `WaAdapter` block contract + Baileys implementation + FakeWaAdapter; nightly quarantine cleanup.
3. Web: the screens above from the mock; contract test against the real route table.
4. Enterprise: `wa-cloud` blocking; online reputation connector.
5. Security review (no new listener; media serving and file parsing are the risk), unit tests ≥ 90 % changed lines,
   e2e round, Dev Build check, Baileys block smoke-test on a spare number.

## Small decisions (delegated to Claude by the owner, 2026-10-31)

- AI check runs only when a rule found something; daily cap 200 checks per inbox, then rules only (logged as a count).
- Files larger than 25 MB skip the content check: name and type only (ZIP directory read up to 2,000 entries).
- "Existing customer" = the team replied before, or a saved customer profile, or the chat is older than 7 days.
- "Trust this sender" covers files or texts from that number only (not both), until an admin removes it on Safety.
- Locked files are deleted after 30 days by default; deleting keeps the message and the Safety row.
- Admin alert = the existing push to admins (`safety:high`), at most one per number per hour.
- Group messages are checked and flagged; auto-block never applies to group members (blocking a member would not
  remove them from the group).
- History import (messages from before linking) is checked by rules only, never by the AI, and never auto-blocks.

## Answered questions (owner, 2026-10-31)

1. AI check default: **on when the install has an AI connection configured** (new and existing installs); off
   otherwise, and it turns on by itself only through the admin switch.
2. Safety page: **admins only**.

## Confirmation

Confirmed 2026-10-31 by the owner in a comment on the screenshot review page: "look good, 2. start on if account has
AI configure, 3. admin only". The mock as proposed (revision `d2f5ee530a65158167763b7078e48bfb6083f27a`), AI check on by default when an AI is
configured, Safety page for admins only.
