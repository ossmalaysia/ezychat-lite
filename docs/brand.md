# WA Team Inbox — brand assets

The app mark is two smiling chat teammates, lilac and coral, on a deep teal square.
The original generated artwork, PNG exports and Windows ICO live in `design/app-icon/`.
See its README for prompts, provenance and encoding details. The previous tray/inbox
source in `docs/brand/` is historical; it is no longer used for the app icon.

| File                                               | Size(s)                      | Purpose                                             |
| -------------------------------------------------- | ---------------------------- | --------------------------------------------------- |
| `design/app-icon/app-icon-master.png`              | 1254                         | Original generated artwork                          |
| `apps/desktop/build/icon.png`                      | 512                          | Electron desktop icon                               |
| `apps/desktop/build/icon.ico`                      | 16, 24, 32, 48, 64, 128, 256 | Windows app / installer icon                        |
| `apps/desktop/build/tray/trayTemplate.png` / `@2x` | 22 / 44                      | Existing monochrome macOS menu-bar template         |
| `apps/desktop/build/tray/tray.png` / `@2x`         | 16 / 32                      | Windows/Linux tray                                  |
| `apps/web/public/icon-192.png`, `icon-512.png`     | 192, 512                     | PWA manifest icons (`purpose: any`) and in-app mark |
| `apps/web/public/icon-maskable-512.png`            | 512                          | Opaque maskable export with centered 360px artwork  |
| `apps/web/public/apple-touch-icon.png`             | 180                          | iOS home screen                                     |
| `apps/web/public/favicon.ico`                      | 16, 24, 32, 48, 64, 128, 256 | Browser favicon                                     |

## Publishing and re-exporting

Publish the checked-in design exports without installing image dependencies:

```powershell
node scripts/generate-icons.mjs
```

If the generated master changes, re-export with Python and Pillow first:

```powershell
python design/app-icon/export-assets.py
node scripts/generate-icons.mjs
```

Resizing and encoding preserve the illustration. The maskable export adds teal padding.
The publishing script checks all inputs before copying them; it keeps the existing
macOS monochrome tray templates so menu-bar appearance follows system conventions.
The obsolete SVG icon is removed so browsers and installed PWAs use the same artwork.

## Illustrations

Empty-state / onboarding spot illustrations live in `apps/web/public/illustrations/` and are referenced as `/illustrations/<name>.png`. Transparent background (edge-connected white removed, enclosed white fills kept so they read in dark mode), trimmed, max width 640px, palette-quantised PNG (~20-40 KB each).

| File                | Size    | Subject                                                                     |
| ------------------- | ------- | --------------------------------------------------------------------------- |
| `empty-inbox.png`   | 485x292 | Empty inbox tray with a small resting chat bubble                           |
| `no-results.png`    | 595x397 | Magnifying glass over empty chat bubbles                                    |
| `link-whatsapp.png` | 640x311 | Smartphone with abstract QR-like pattern next to a laptop, dotted-line link |
| `tunnel.png`        | 640x432 | Cloud with a secure padlock linking a laptop and a phone                    |
| `welcome.png`       | 490x559 | Inbox tray with three chat bubbles rising out, sparkles                     |

Generated with Codex CLI image generation, one job per image:

```sh
codex exec --skip-git-repo-check -s workspace-write "Use your built-in image generation tool to create a <STYLE>, depicting <SUBJECT>. Save it as <name>.png in the current working directory."
```

`<STYLE>` (shared by all five):

> flat minimal vector-style spot illustration, 1024x768, plain pure white background, palette strictly deep teal #0F766E, light teal #CCFBF1, slate #334155 and light slate #E2E8F0, thin rounded line work, generous whitespace, no text, no letters, no numbers, no logos, no people faces, no WhatsApp branding or green

`<SUBJECT>` is the Subject column above (verbatim: "an empty inbox tray with a small resting chat bubble", "a magnifying glass over empty chat bubbles", "a smartphone showing an abstract QR-like square pattern next to a laptop, connected by a dotted line", "a cloud with a secure padlock link between a laptop and a phone", "an inbox tray with three chat bubbles of different sizes rising out, celebratory sparkles").

Post-processing (sharp, installed in a temp dir as for icons): flood-fill near-white (min channel >= 240) from the image borders to alpha 0, soften the fringe, trim, pad 6%, resize to fit 640x640, `png({ palette: true, quality: 90, effort: 10 })`.
