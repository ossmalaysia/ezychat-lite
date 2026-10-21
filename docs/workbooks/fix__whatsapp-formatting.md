# Workbook: WhatsApp formatting in messages

Branch: `fix/whatsapp-formatting` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | Owner: must match how the WhatsApp app renders the message (no HTML mock: parity with WhatsApp) | 2026-10-21 |
| Dev | done | formatWhatsApp/plainWhatsApp; bubble, quote preview, chat list | 2026-10-21 |
| Unit tests | done | 9 formatter tests; inbox+lib 185 passed | 2026-10-21 |
| E2E | done | 70 passed incl. whatsapp-format.spec; electron-links 15/15 | 2026-10-21 |
| Dev Build | skip | Display only; covered by the e2e run on the fake-WhatsApp dev server | 2026-10-21 |
| Screen review | done | Bubble at 1280 and 360 from the e2e run | 2026-10-21 |

## Log

- 2026-10-21 Design: done — Owner: must match how the WhatsApp app renders the message (no HTML mock: parity with WhatsApp)
- 2026-10-21 Dev: done — formatWhatsApp/plainWhatsApp; bubble, quote preview, chat list
- 2026-10-21 Unit tests: done — 9 formatter tests; inbox+lib 185 passed
- 2026-10-21 E2E: done — 70 passed incl. whatsapp-format.spec; electron-links 15/15
- 2026-10-21 Screen review: done — Bubble at 1280 and 360 from the e2e run
- 2026-10-21 Dev Build: skip — Display only; covered by the e2e run on the fake-WhatsApp dev server
