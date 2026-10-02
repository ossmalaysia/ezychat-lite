# WA Team Inbox — brand assets

Mark: teal `#0F766E` rounded square, white inbox tray with a chat bubble (three dots).
Source of truth: `docs/brand/icon-source-1024.png` (1024x1024, opaque, white outside the rounded corners).

| File | Size(s) | Purpose |
|---|---|---|
| `apps/desktop/build/icon.png` | 1024 | Transparent master (rounded-rect alpha mask); electron-builder mac/linux icon |
| `apps/desktop/build/icon.ico` | 16, 24, 32, 48, 64, 128, 256 | Windows app / installer icon |
| `apps/desktop/build/tray/trayTemplate.png` / `@2x` | 22 / 44 | macOS menu-bar template image (black glyph on transparent) |
| `apps/desktop/build/tray/tray.png` / `@2x` | 16 / 32 | Windows/Linux tray (full-colour transparent icon) |
| `apps/web/public/icon-192.png`, `icon-512.png` | 192, 512 | PWA manifest icons (`purpose: any`) |
| `apps/web/public/icon-maskable-512.png` | 512 | PWA maskable icon: full-bleed teal, glyph inside the 80% safe zone |
| `apps/web/public/apple-touch-icon.png` | 180 | iOS home screen (opaque; iOS rounds corners) |
| `apps/web/public/favicon.ico` | 16, 32, 48 | Browser favicon |
| `apps/web/public/icon.svg` | vector | Hand-drawn SVG approximation of the mark (favicon/in-app logo) |

## Regenerating

sharp and png-to-ico are not repo dependencies; install them in a temp dir:

```sh
mkdir -p /tmp/icongen && cd /tmp/icongen && npm init -y && npm i sharp png-to-ico
cd <repo>
ICONGEN_MODULES=/tmp/icongen/node_modules node scripts/generate-icons.mjs [path/to/source-1024.png]
```

All raster files above are overwritten. `icon.svg` is maintained by hand — update it if the mark changes.

## Illustrations

Empty-state / onboarding spot illustrations live in `apps/web/public/illustrations/` and are referenced as `/illustrations/<name>.png`. Transparent background (edge-connected white removed, enclosed white fills kept so they read in dark mode), trimmed, max width 640px, palette-quantised PNG (~20-40 KB each).

| File | Size | Subject |
| --- | --- | --- |
| `empty-inbox.png` | 485x292 | Empty inbox tray with a small resting chat bubble |
| `no-results.png` | 595x397 | Magnifying glass over empty chat bubbles |
| `link-whatsapp.png` | 640x311 | Smartphone with abstract QR-like pattern next to a laptop, dotted-line link |
| `tunnel.png` | 640x432 | Cloud with a secure padlock linking a laptop and a phone |
| `welcome.png` | 490x559 | Inbox tray with three chat bubbles rising out, sparkles |

Generated with Codex CLI image generation, one job per image:

```sh
codex exec --skip-git-repo-check -s workspace-write "Use your built-in image generation tool to create a <STYLE>, depicting <SUBJECT>. Save it as <name>.png in the current working directory."
```

`<STYLE>` (shared by all five):

> flat minimal vector-style spot illustration, 1024x768, plain pure white background, palette strictly deep teal #0F766E, light teal #CCFBF1, slate #334155 and light slate #E2E8F0, thin rounded line work, generous whitespace, no text, no letters, no numbers, no logos, no people faces, no WhatsApp branding or green

`<SUBJECT>` is the Subject column above (verbatim: "an empty inbox tray with a small resting chat bubble", "a magnifying glass over empty chat bubbles", "a smartphone showing an abstract QR-like square pattern next to a laptop, connected by a dotted line", "a cloud with a secure padlock link between a laptop and a phone", "an inbox tray with three chat bubbles of different sizes rising out, celebratory sparkles").

Post-processing (sharp, installed in a temp dir as for icons): flood-fill near-white (min channel >= 240) from the image borders to alpha 0, soften the fringe, trim, pad 6%, resize to fit 640x640, `png({ palette: true, quality: 90, effort: 10 })`.
