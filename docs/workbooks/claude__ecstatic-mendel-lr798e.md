# Workbook: Tag group members (@mention)

Branch: `claude/ecstatic-mendel-lr798e` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | doing | group-mentions mock + design (docs/features/group-mentions), waiting for owner confirmation | 8bfeef9 | 2026-10-31 |
| Dev | doing | Server/wa/shared: send mentions (route, queue, Baileys, fake, capability). Web composer after mock confirmation | 8bfeef9 | 2026-10-31 |
| Unit tests | pass | send-mentions.test.ts (9), Baileys mention send, shared capability default; bite proof: dropping job.mentions fails 2 tests | 8bfeef9 | 2026-10-31 |
| E2E | todo |  |  |  |
| Dev Build | todo |  |  |  |
| Screen review | todo |  |  |  |

## Log

- 2026-10-31 Design: doing — group-mentions mock + design (docs/features/group-mentions), waiting for owner confirmation (8bfeef9)
- 2026-10-31 Dev: doing — Server/wa/shared: send mentions (route, queue, Baileys, fake, capability). Web composer after mock confirmation (8bfeef9)
- 2026-10-31 Unit tests: pass — send-mentions.test.ts (9), Baileys mention send, shared capability default; bite proof: dropping job.mentions fails 2 tests (8bfeef9)
