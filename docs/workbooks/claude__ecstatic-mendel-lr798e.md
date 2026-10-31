# Workbook: Tag group members (@mention)

Branch: `claude/ecstatic-mendel-lr798e` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | group-mentions mock confirmed 2026-10-31 ("build it until merge to main"); latestConfirmed updated | 331942a | 2026-10-31 |
| Dev | done | Composer @ picker (inbox/mentions.ts, MentionPicker.tsx), Conversation + useSendText mentions/shown, useInboxCanTag, en/ms/zh-CN | 331942a | 2026-10-31 |
| Unit tests | pass | Final head: web mention tests 14 passed; full suite 4,063 passed; changed-lines coverage 97.1 % | 31fdb55 | 2026-10-31 |
| E2E | pass | Final head: e2e/mentions.spec.ts 7 passed (desktop, Pixel 7, iPhone); full npm run e2e 131 passed on de5d7af+lint fix (later commit changes only picker markup and the check script) | 31fdb55 | 2026-10-31 |
| Dev Build | pass | Final head: devbuild-mentions-check.mjs 35/35 on a fresh --mode dev --fake-wa server with the rebuilt web; real WhatsApp untested | 31fdb55 | 2026-10-31 |
| Screen review | pass | Final head: picker, picked, sent at 1280/360 light+dark unchanged from the reviewed shots; matches the confirmed mock | 31fdb55 | 2026-10-31 |

## Log

- 2026-10-31 Design: doing — group-mentions mock + design (docs/features/group-mentions), waiting for owner confirmation (8bfeef9)
- 2026-10-31 Dev: doing — Server/wa/shared: send mentions (route, queue, Baileys, fake, capability). Web composer after mock confirmation (8bfeef9)
- 2026-10-31 Unit tests: pass — send-mentions.test.ts (9), Baileys mention send, shared capability default; bite proof: dropping job.mentions fails 2 tests (8bfeef9)
- 2026-10-31 Design: done — group-mentions mock confirmed 2026-10-31 ("build it until merge to main"); latestConfirmed updated (331942a)
- 2026-10-31 Dev: done — Composer @ picker (inbox/mentions.ts, MentionPicker.tsx), Conversation + useSendText mentions/shown, useInboxCanTag, en/ms/zh-CN (331942a)
- 2026-10-31 Unit tests: pass — web: mentions.test, Composer.mentions.test, mention-send.test (14; bite proof fails 3); server send-mentions (9); inbox-types (331942a)
- 2026-10-31 E2E: pass — e2e/mentions.spec.ts composer tagging: desktop, Pixel 7, iPhone (7 passed); full e2e at the end (331942a)
- 2026-10-31 Dev Build: pass — devbuild-mentions-check.mjs 35/35 on --mode dev --fake-wa + built web; real WhatsApp untested (331942a)
- 2026-10-31 Screen review: pass — Picker, picked, sent at 1280/360 light+dark match the confirmed mock; no overflow; docs/screenshots/chat/mention-* (331942a)
- 2026-10-31 E2E: pass — Full npm run e2e: 131 passed, 27 skipped, 0 failed; screens.smoke 35/37 (oauth-authorize expected 409 on fresh data, as logged before); e2e:electron-links is Windows-only, not run in this Linux container (de5d7af)
- 2026-10-31 E2E: pass — Final head: e2e/mentions.spec.ts 7 passed (desktop, Pixel 7, iPhone); full npm run e2e 131 passed on de5d7af+lint fix (later commit changes only picker markup and the check script) (31fdb55)
- 2026-10-31 Dev Build: pass — Final head: devbuild-mentions-check.mjs 35/35 on a fresh --mode dev --fake-wa server with the rebuilt web; real WhatsApp untested (31fdb55)
- 2026-10-31 Screen review: pass — Final head: picker, picked, sent at 1280/360 light+dark unchanged from the reviewed shots; matches the confirmed mock (31fdb55)
- 2026-10-31 Unit tests: pass — Final head: web mention tests 14 passed; full suite 4,063 passed; changed-lines coverage 97.1 % (31fdb55)
