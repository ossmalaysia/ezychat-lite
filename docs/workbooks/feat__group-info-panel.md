# Workbook: Group info: WhatsApp group members

Branch: `feat/group-info-panel` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | interactive mockup approved (phone/desktop, search, admins, details, Message confirm); owner chose: Message button with warning, show only what Baileys gives; later: open by tapping the group name instead of a button | 2026-10-11 |
| Dev | done | wa getGroupInfo/getAbout + groupChanged; server /chats/:jid/members (+about, avatar, start chat), 5-min cache; web GroupPanel, clickable chat header, letters-only initials | 2026-10-11 |
| Unit tests | pass | typecheck + lint green; shared 29, wa 84, server 881, desktop 310 (+1 skipped), web 494 (maxWorkers=2); web build green | 2026-10-11 |
| E2E | pass | 55 passed, 6 skipped incl. new group-info.spec on desktop/mobile/iphone; customer-profile selectors made exact | 2026-10-11 |
| Dev Build | pass | fake WA, 965-member group (named, number-only, hidden-number, usernames, admins): 1280 + 360, en/ms, light/dark; search, admins, About, Open chat, Message confirm, Start chat; real-WhatsApp check pending (owner) | 2026-10-11 |
| Screen review | done | vs approved mockup at 1280/360, ms+dark; fixed initials ((J, ~, +), dropped duplicate Admin in details, header button replaced by tapping the name | 2026-10-11 |

## Log

- 2026-10-11 Design: done — interactive mockup approved (phone/desktop, search, admins, details, Message confirm); owner chose: Message button with warning, show only what Baileys gives; later: open by tapping the group name instead of a button
- 2026-10-11 Dev: done — wa getGroupInfo/getAbout + groupChanged; server /chats/:jid/members (+about, avatar, start chat), 5-min cache; web GroupPanel, clickable chat header, letters-only initials
- 2026-10-11 Dev Build: pass — fake WA, 965-member group (named, number-only, hidden-number, usernames, admins): 1280 + 360, en/ms, light/dark; search, admins, About, Open chat, Message confirm, Start chat; real-WhatsApp check pending (owner)
- 2026-10-11 Screen review: done — vs approved mockup at 1280/360, ms+dark; fixed initials ((J, ~, +), dropped duplicate Admin in details, header button replaced by tapping the name
- 2026-10-11 Unit tests: pass — typecheck + lint green; shared 29, wa 84, server 881, desktop 310 (+1 skipped), web 494 (maxWorkers=2); web build green
- 2026-10-11 E2E: pass — 55 passed, 6 skipped incl. new group-info.spec on desktop/mobile/iphone; customer-profile selectors made exact
- 2026-10-12 Review fixes (Codex): new member chats keyed by LID; group list learns live phone/LID pairs first (recycled numbers); All/Admins chips count search matches; Message confirm now the AlertDialog primitive (inline confirm in mockup → modal). group-info e2e 4/4 pass
