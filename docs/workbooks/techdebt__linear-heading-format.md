# Workbook: Strip AI reply headings in linear time (L-30)

Branch: `techdebt/linear-heading-format` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | tech-debt fix, no design | f36bd86 | 2026-11-24 |
| Dev | done | linear line scanner replaces the cubic heading regex in ai/whatsapp-format.ts | f36bd86 | 2026-11-24 |
| Unit tests | done | whatsapp-format.test.ts: seeded fuzz (5,000 lines) vs the old pattern + 20,000-blank timing test; hangs >60 s on the old code; 100 % lines | f36bd86 | 2026-11-24 |
| E2E | todo |  |  |  |
| Dev Build | todo |  |  |  |
| Screen review | skip | no screen changed | f36bd86 | 2026-11-24 |

## Log

- 2026-11-24 Dev: done — linear line scanner replaces the cubic heading regex in ai/whatsapp-format.ts (f36bd86)
- 2026-11-24 Unit tests: done — whatsapp-format.test.ts: seeded fuzz (5,000 lines) vs the old pattern + 20,000-blank timing test; hangs >60 s on the old code; 100 % lines (f36bd86)
- 2026-11-24 Screen review: skip — no screen changed (f36bd86)
- 2026-11-24 Design: skip — tech-debt fix, no design (f36bd86)
