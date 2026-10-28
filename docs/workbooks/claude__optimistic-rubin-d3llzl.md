# Workbook: files and text in and out of the app (Lite core, inherited by Enterprise)

Branch: `claude/optimistic-rubin-d3llzl` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

## Design

Owner request (2026-10-27): "allow file drop, copy paste on text, and object in and out the app" for Lite and
Enterprise. Enterprise uses the core web app and desktop shell, so all of it lands in Lite and reaches
Enterprise through the next `@ezychat/*` release (no Enterprise code change; bump the pinned core).

Reused: Composer attach button and `onAttach` → `useSendMedia` (`POST /chats/:jid/media`, 64 MB limit, now
`MEDIA_UPLOAD_LIMIT_BYTES` in shared), the hover Reply/React buttons and the press-and-hold reaction bar
(Reply row), the image Lightbox (Download), the desktop `t()` catalogs and `isInboxUrl`.

In:
- Conversation is a drop zone (`components/app/FileDropZone.tsx`): files from the OS show an overlay; dropped
  files go to the composer tray. Blocked sending or a closed reply window shows "Files can't be sent…" and
  refuses the drop. Business context (Admin → AI agent) takes a dropped file into its existing add dialog.
- Composer: picker takes several files; paste of files (screenshots, Explorer/Finder copies) joins the tray,
  text from Office/web pages (clipboard with `text/html`) pastes as text. Tray: thumbnail or file icon, name,
  size, Remove, Remove all; placeholder becomes "Add a caption (optional)"; Send uploads one by one in order,
  caption and quote on the first file only. Refused before upload: empty, > 64 MB, more than 10.
- A page-wide guard stops a stray file drop from replacing the app (browser) or navigating (desktop).

Out:
- Copy text button on every message with text (hover; touch: press-and-hold bar), WhatsApp marks kept.
  LAN http falls back to a selection copy (Clipboard API needs a secure context).
- Copy image in the Lightbox where the browser allows images on the clipboard (converted to PNG).
- Drag an image or document out of a chat: `DownloadURL` drag (Chromium browsers and Electron) saves it.
- Desktop right-click menu (`apps/desktop/src/context-menu.ts`): spelling suggestions + Add to dictionary,
  Copy image / Save image as… (inbox media only), Copy link address (http(s)/mailto, not app links),
  Undo/Redo/Cut/Copy/Paste/Paste as plain text/Select all in editable fields, Copy for selected text.

No HTML mock was made: the owner asked for the change directly. The UI adds a tray above the composer, a drop
overlay and one hover button; screen review and mock confirmation are open items for the owner.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | Owner asked for the change directly; no HTML mock (see Design section) | af8d1ea | 2026-10-27 |
| Dev | done | Drop/paste/multi-pick into a tray, Copy text, Copy image, drag media out, Business context drop, desktop right-click menu | 2f74993 | 2026-10-27 |
| Unit tests | pass | Taken over 2026-10-28: main merged; full suite 3803 passed with coverage (changed lines 94.2 %, total 90.45 %); review fixes with tests | 5116f716 | 2026-10-28 |
| E2E | pass | Final 5116f716, 1 worker: npm run e2e 117 passed, 23 skipped, 0 failed; npm run e2e:electron-links 17/17 screens | 5116f716 | 2026-10-28 |
| Dev Build | pass | packaged build 437883a3: devbuild-file-transfer-check 5/5, Electron screens all PASS, browser screens 35/37 (oauth-authorize expected 409, AI access off) | 437883a3 | 2026-10-28 |
| Screen review | pass | packaged build 437883a3: screens.smoke + electron-screens.smoke; screenshots in docs/screenshots/file-transfer | 437883a3 | 2026-10-28 |

## Log

- 2026-10-27 Dev: done — Drop/paste/multi-pick into a tray, Copy text, Copy image, drag media out, Business context drop, desktop right-click menu (2f74993)
- 2026-10-27 E2E: pass — e2e/file-transfer.spec.ts passes; full run 104 passed, ai-member (document worker, container-only) and pwa-resume (clock flake, 3/4 on repeat) fail, both untouched (2f74993)
- 2026-10-27 Design: skip — Owner asked for the change directly; no HTML mock (see Design section) (af8d1ea)
- 2026-10-27 Unit tests: pass — changed-lines coverage 91.2 %; only the 4 container-only document-worker tests fail (untouched) (af8d1ea)
- 2026-10-27 Screen review: doing — 16 shots in docs/screenshots/file-transfer (1280/360, light/dark); overlay made more opaque; owner review pending (af8d1ea)
- 2026-10-27 Dev Build: todo — Not yet: real desktop window on Windows (Electron drag-out, right-click menu, Explorer paste) (af8d1ea)
- 2026-10-27 E2E: pass — On head: file-transfer, responsive (360 px), reply specs 21 passed. Full run earlier 104 passed; ai-member (container-only document worker) and pwa-resume (clock flake) fail, untouched. Desktop-window link check not run (no Windows here) (2f989e0)
- 2026-10-27 E2E: pass — On head 53dfd7b: file-transfer, responsive (360 px), reply 21 passed; ai-member fails only at the server document reader ('Cannot read this document', container-only, CI unit tests green on all 3 OS). Desktop-window link check not run (no Windows here) (53dfd7b)
- 2026-10-27 E2E: pass — On merge head bd1c425: file-transfer, responsive (360 px), reply, reply-suggestions 25 passed. Desktop-window link check not run (no Windows here) (bd1c425)
- 2026-10-28 Unit tests: pass — Taken over 2026-10-28: main merged; full suite 3803 passed with coverage (changed lines 94.2 %, total 90.45 %); review fixes with tests (5116f716)
- 2026-10-28 E2E: pass — Final 5116f716, 1 worker: npm run e2e 117 passed, 23 skipped, 0 failed; npm run e2e:electron-links 17/17 screens (5116f716)
- 2026-10-28 Dev Build: pass — packaged build 437883a3: devbuild-file-transfer-check 5/5, Electron screens all PASS, browser screens 35/37 (oauth-authorize expected 409, AI access off) (437883a3)
- 2026-10-28 Screen review: pass — packaged build 437883a3: screens.smoke + electron-screens.smoke; screenshots in docs/screenshots/file-transfer (437883a3)
