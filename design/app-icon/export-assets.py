"""Export the official EzyChat mark without redrawing or stretching its artwork."""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parent
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
PNG_SIZES = (16, 32, 64, 192, 256, 512)


def main() -> None:
    with Image.open(ROOT / "app-icon-master.png") as image:
        source = image.convert("RGBA")
    # The official PNG renders a white parrot using enclosed transparent holes
    # on its website's white surface. Retain that appearance on dark surfaces
    # and opaque green home-screen formats, while preserving outer transparency.
    outline = source.getchannel("A").point(lambda alpha: 255 if alpha == 255 else 0)
    for corner in ((0, 0), (source.width - 1, 0), (0, source.height - 1),
                   (source.width - 1, source.height - 1)):
        ImageDraw.floodfill(outline, corner, 128)
    inside = outline.point(lambda value: 255 if value == 0 else 0)
    rendered = Image.new("RGBA", source.size, (255, 255, 255, 255))
    rendered.putalpha(inside)
    rendered.alpha_composite(source)
    rendered.save(ROOT / "ezychat-logo.png", optimize=True)
    # The official source is slightly rectangular. Preserve its proportions.
    side = max(source.size)
    master = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    master.alpha_composite(rendered, ((side - source.width) // 2, (side - source.height) // 2))

    for size in PNG_SIZES:
        master.resize((size, size), Image.Resampling.LANCZOS).save(
            ROOT / f"app-icon-{size}.png", optimize=True
        )

    # Home-screen formats require an opaque background, sampled from the source.
    background = source.getpixel((0, source.height // 2))[:3] + (255,)
    apple = Image.new("RGBA", (180, 180), background)
    apple.alpha_composite(master.resize((180, 180), Image.Resampling.LANCZOS))
    apple.convert("RGB").save(ROOT / "apple-touch-icon.png", optimize=True)

    # Keep the parrot/headset inside the central 80% maskable safe-area circle.
    maskable = Image.new("RGBA", (512, 512), background)
    maskable.alpha_composite(master.resize((360, 360), Image.Resampling.LANCZOS), (76, 76))
    maskable.convert("RGB").save(ROOT / "app-icon-maskable-512.png", optimize=True)

    master.save(
        ROOT / "app-icon.ico",
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
    )

    # macOS templates use the same parrot as a black alpha silhouette.
    red, green, blue, alpha = master.split()
    minimum = ImageChops.darker(ImageChops.darker(red, green), blue)
    white = minimum.point(lambda value: max(0, min(255, round((value - 160) * 255 / 95))))
    template = Image.new("RGBA", master.size, (0, 0, 0, 0))
    template.putalpha(ImageChops.multiply(white, alpha))
    for size in (16, 32):
        template.resize((size, size), Image.Resampling.LANCZOS).save(
            ROOT / f"tray-template-{size}.png", optimize=True
        )

    with Image.open(ROOT / "app-icon.ico") as icon:
        assert icon.ico.sizes() == {(size, size) for size in ICO_SIZES}
        for size in ICO_SIZES:
            frame = icon.ico.getimage((size, size))
            assert frame.size == (size, size)
            low, high = frame.convert("RGBA").getchannel("A").getextrema()
            assert low < 32 and high == 255
            # The parrot body must remain visible, rather than a transparent hole.
            assert frame.convert("RGBA").getpixel((size // 2, size * 3 // 4))[3] >= 250

    for filename in ("apple-touch-icon.png", "app-icon-maskable-512.png"):
        with Image.open(ROOT / filename) as image:
            assert image.convert("RGBA").getchannel("A").getextrema() == (255, 255)

    print(f"Source: {source.width} x {source.height}; square: {side}; ICO sizes: {ICO_SIZES}")
    print(f"PNG sizes: {PNG_SIZES}")
    print(f"Apple touch: 180 x 180; maskable: 512 x 512; padding color: {background}")


if __name__ == "__main__":
    main()
