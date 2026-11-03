# Workbook: Open PDFs and photos inside the app

Branch: `claude/focused-cray-09aygy` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | partial | Owner asked 2026-11-03 to open PDFs and images in the app instead of saving first; reuses the image preview frame. No HTML mock: screenshots in docs/screenshots/chat/pdf-* for confirmation | 2026-11-03 |
| Dev | done | lib/pdf.ts (pdf.js 6.4.299, lazy), inbox/PdfViewer.tsx, MediaView document row (open + download), en/ms/zh-CN | 2026-11-03 |
| Unit tests | done | pdf 7, PdfViewer 6, MediaView/MessageCopy, i18n, web-client-contract | 2026-11-03 |
| E2E | done | e2e/pdf-viewer.spec.ts on desktop-chromium + mobile: real PDF drawn by the pdf.js worker under the production CSP | 2026-11-03 |
| Dev Build | todo | Windows desktop app: open a real customer PDF (and a CJK PDF) from a linked number; not run in this cloud session | 2026-11-03 |
| Screen review | done | Viewer + bubble at 1280 and 360, light and dark; viewer made opaque after review (chat showed through the toolbar) | 2026-11-03 |

## Log

- 2026-11-03 Dev: done — pdf.js viewer, image-file preview, translations
- 2026-11-03 Unit tests: done — new and touched files only
- 2026-11-03 E2E: done — pdf-viewer.spec.ts desktop + mobile
- 2026-11-03 Screen review: done — 1280/360 light/dark, background made opaque
