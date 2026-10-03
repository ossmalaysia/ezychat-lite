# EzyChat Lite brand icon

EzyChat Lite uses EzyChat's official headset parrot on a green gradient tile.
The mark stays unchanged; the application wordmark supplies the **Lite** name.

## Source and provenance

Retrieved on 2026-10-03 from the user-provided `anchorsprint/ezychat-remake` repository:

- Original source: [`apps/app/src/app/icon.png`](https://github.com/anchorsprint/ezychat-remake/blob/main/apps/app/src/app/icon.png).
- Source tree SHA: `c9d3ffb943206e8c8b18c18e3f8f28929ae389c7`.
- PNG blob SHA: `a8949238b1c8fa83c1d8e02a9af1ae9053d6fd60`.
- `apps/app/public/brand/ezychat-logo.png` and `apps/app/public/marketing/logo.png`
  contain the identical PNG. The canonical `Logo` component describes it as the headset parrot.
- `app-icon-master.png` is that unchanged original 763 × 743 RGBA PNG, including
  its genuine transparent rounded corners and enclosed parrot cutouts.

The marketing phone mockup and audience photos were reviewed but are not app icons.
The sales mockup depicts the hosted sales agent, rather than Lite's local team inbox.

## Exports

- `app-icon-{16,32,64,192,256,512}.png`: aspect-preserving square PNG exports.
- `app-icon.ico`: Windows icon with 16, 24, 32, 48, 64, 128 and 256 px frames.
- `apple-touch-icon.png`: opaque 180 × 180 home-screen image.
- `app-icon-maskable-512.png`: opaque 512 × 512 PWA image. The mark is centered
  at 360 × 360 to retain the parrot inside the central maskable safe area.
- `tray-template-{16,32}.png`: black alpha silhouettes of the official white
  parrot/headset for macOS menu-bar template rendering.
- `ezychat-logo.png`: original proportions with the parrot cutout rendered white,
  published to `apps/web/public/brand/ezychat-logo.png`.

Square exports center the artwork with transparent padding; they do not stretch it.
The original PNG encodes its white parrot as enclosed transparency, relying on
a white page behind it. Exports fill only those enclosed holes white so the same
mark remains visible in dark mode; the outer rounded corners remain transparent.
Apple and maskable exports flatten their background with a green sampled from the
source tile. Desktop PNG/ICO exports preserve the intentional rounded transparency.
The exporter checks every embedded ICO frame and the opaque home-screen formats.

## Reproduce

```powershell
python design/app-icon/export-assets.py
node scripts/generate-icons.mjs
```

The Python exporter requires Pillow. The publishing script checks every input before
copying the exports into desktop, browser and PWA asset paths. Electron Builder creates
the platform icon resources from the published PNG/ICO during packaging.
