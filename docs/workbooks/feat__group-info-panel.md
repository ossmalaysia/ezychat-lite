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
- 2026-10-12 Review fixes (Codex round 3): re-pointed numbers no longer copy old owner's names; a number is never shown as a member name; About/photo caches keyed by LID. Server alias/name tests 157 pass, GroupPanel 7 pass
- 2026-10-12 Real WhatsApp: pass — owner's phone, 965-member LID group: all listed (0.5–0.8 s), 534 numbers/431 hidden+usernames, photos OK, About mostly private/empty (logged shape). Fixed number-as-name for 11 hidden members (team-known number now shown)
- 2026-10-12 Review fixes (Codex round 5): start chat posts the LID; moved numbers never re-sync old names on later reads; About not cached while offline (503); audit label + Group field in en/ms/zh-CN
- 2026-10-12 Review fixes (Codex round 6): moved-number names guarded centrally in syncNames (contacts sync too); getAbout throws on failure/offline and failures are never cached
- 2026-10-12 Review fixes (Codex round 7): incoming names on moved numbers ignored; invalidated in-flight group reads discarded; About failure shows Couldn't load + Try again
- 2026-10-12 Review fix (Codex round 8): moved numbers are never a name-sync destination either
- 2026-10-12 Review fix (Codex round 9): a chat found via a phone number is used only while that number still points at the member's LID
- 2026-10-12 Review fix (Codex round 10): About/photo looked up by number only while it still points at the member, else by LID
- 2026-10-12 Review fixes (Codex round 11): a superseded group read that fails follows the newer read; failed photo lookups are never cached (404/401 = no photo)
- 2026-10-12 Screenshots refreshed (marketing script on fresh fake-WA data): new chat/group-info desktop+mobile; script seeds a Kopi Apong Regulars group
