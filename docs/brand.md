# EzyChat Lite — brand assets

EzyChat Lite uses the official EzyChat headset parrot on a green gradient tile, with the
**EzyChat Lite** name in the interface. The original artwork, exports, Windows ICO and
source provenance live in [design/app-icon](../design/app-icon/README.md).

The same mark appears in the desktop window, installer, browser, installed PWA, home-screen
icon and sharing card. The marketing sales-agent mockups were reviewed but are not used in
Lite because they depict a different product workflow. Existing onboarding illustrations
remain useful for inbox setup.

| Asset                                      | Purpose                                    |
| ------------------------------------------ | ------------------------------------------ |
| `design/app-icon/app-icon-master.png`      | Untouched official source                  |
| `design/app-icon/app-icon.ico`             | Windows ICO with 16–256 px frames          |
| `apps/desktop/build/icon.png` / `icon.ico` | Desktop and installer                      |
| `apps/desktop/build/tray/tray*.png`        | Tray, including macOS monochrome templates |
| `apps/web/public/icon-{192,512}.png`       | PWA and in-app mark                        |
| `apps/web/public/icon-maskable-512.png`    | Maskable PWA icon                          |
| `apps/web/public/apple-touch-icon.png`     | iOS home screen                            |
| `apps/web/public/favicon.ico`              | Browser tabs                               |
| `apps/web/public/brand/ezychat-logo.png`   | Official logo in its original proportions  |
| `apps/web/public/share-app.svg`            | Self-contained social sharing card         |

## Re-export

`python design/app-icon/export-assets.py` creates aspect-preserving exports;
`node scripts/generate-icons.mjs` publishes them to desktop and web. See the design README
for transparency, maskable safe-area and provenance details.

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
