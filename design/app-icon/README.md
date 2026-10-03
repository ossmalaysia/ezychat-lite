# Playful team inbox icon

Two smiling speech-bubble teammates overlap to express a friendly shared inbox.
Lilac and coral faces sit on a deep teal background with dark, bold facial features.
There is no text or phone handset, keeping the design distinct from WhatsApp's logo.

## Assets

- `app-icon-master.png`: original generated 1254 × 1254 RGB master.
- `app-icon.ico`: Windows icon containing 16, 24, 32, 48, 64, 128 and 256 px frames.
- `app-icon-{16,32,64,192,256,512}.png`: resized exports for preview and future integration.
- `apple-touch-icon.png`: opaque 180 × 180 export for Apple home-screen installation.
- `app-icon-maskable-512.png`: opaque 512 × 512 PWA maskable export. The unchanged
  master is resized to 360 × 360 and centered with a 76 px border in the master
  image's exact top-left teal color, retaining both speech-bubble characters inside
  the central safe area when platforms crop the image into different icon shapes.

The final artwork is deliberately opaque. A generated transparent version contained
unwanted holes inside its background; the final image removes those defects and uses
a full teal square. Platforms that apply their own rounded icon mask can use this
square artwork directly. The master remains unchanged during export.

These are the source assets for the application. Run `node scripts/generate-icons.mjs`
to publish them to desktop, browser and PWA paths; see `docs/brand.md`.

## Generation

Created on 2026-10-03 with the built-in image generation tool and visually inspected.
The original request was a fun, youthful app icon. Initial prompt:

> A friendly shared team-inbox app icon: two playful rounded speech-bubble teammates
> leaning together, one soft lilac and one warm coral, each with bold dark dot eyes and
> a simple joyful smile. Premium clean graphic illustration on a deep teal app tile,
> centered, balanced and clear at small sizes. No text, phone handset, official
> WhatsApp mark, recognizable brand imitation, watermark or tiny decorations.

Final correction prompt:

> Finish this app icon as a fully OPAQUE square image suitable for Windows ICO.
> Keep both beautiful playful smiling lilac and coral speech-bubble teammates,
> their eyes and smiles exactly. Replace ALL background behind them including
> the rounded-square tile and outside corners with ONE uniform solid deep teal
> color. No rounded tile border anymore: teal fills the entire square from edge
> to edge. Remove the visible dark blemish at upper right and the blemish near
> bottom center completely. Zero holes, zero shadows, zero dark smudges, zero
> grain or textures anywhere in the teal background. The entire square artwork
> must have no transparent pixels. Keep subject placement, proportions and
> vibrant colors unchanged, no text or extra elements.

## Re-export

With Python and Pillow available, run from the repository root:

```powershell
python design/app-icon/export-assets.py
```

This performs deterministic Lanczos resizing, PNG/ICO encoding and background
padding for the maskable export. It does not redraw, recolor or mask the generated
artwork. The script checks every embedded ICO size and verifies that all frames are
opaque.
