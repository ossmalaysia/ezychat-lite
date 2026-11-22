# Workbook: feat/own-image-preview

Branch: `feat/own-image-preview` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | Bug fix inside the existing chat image bubble; no new screen or flow (design PR #333) | 6ff85ef | 2026-11-22 |
| Dev | done | Own 800 px chat preview from the stored JPEG (jpeg-js worker, media_thumbs.own, ?v=2, no-cache for WhatsApp's) | 6ff85ef | 2026-11-22 |
| Unit tests | done | image-preview.test.ts + messages.test.ts own-preview cases; 4 files 91 tests pass | 6ff85ef | 2026-11-22 |
| E2E | todo |  |  |  |
| Dev Build | pass | e2e/devbuild-image-preview.mjs on the bundled server: 600x800, 91 KB of 296 KB, 249 ms then 5 ms, immutable | 6ff85ef | 2026-11-22 |
| Screen review | todo |  |  |  |

## Log

- 2026-11-22 Dev: done — Own 800 px chat preview from the stored JPEG (jpeg-js worker, media_thumbs.own, ?v=2, no-cache for WhatsApp's) (6ff85ef)
- 2026-11-22 Design: skip — Bug fix inside the existing chat image bubble; no new screen or flow (design PR #333) (6ff85ef)
- 2026-11-22 Unit tests: done — image-preview.test.ts + messages.test.ts own-preview cases; 4 files 91 tests pass (6ff85ef)
- 2026-11-22 Dev Build: pass — e2e/devbuild-image-preview.mjs on the bundled server: 600x800, 91 KB of 296 KB, 249 ms then 5 ms, immutable (6ff85ef)
