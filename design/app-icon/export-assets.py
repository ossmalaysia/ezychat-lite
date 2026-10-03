"""Encode the generated master at app-icon sizes; never redraw the artwork."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
PNG_SIZES = (16, 32, 64, 192, 256, 512)


def main() -> None:
    with Image.open(ROOT / "app-icon-master.png") as image:
        assert image.width == image.height, "The master must be square."
        master = image.convert("RGBA")

    for size in PNG_SIZES:
        master.resize((size, size), Image.Resampling.LANCZOS).save(
            ROOT / f"app-icon-{size}.png", optimize=True
        )

    master.resize((180, 180), Image.Resampling.LANCZOS).save(
        ROOT / "apple-touch-icon.png", optimize=True
    )

    # Add export padding without changing the generated illustration.
    background = master.getpixel((0, 0))
    maskable = Image.new("RGBA", (512, 512), background)
    maskable.paste(master.resize((360, 360), Image.Resampling.LANCZOS), (76, 76))
    maskable.save(ROOT / "app-icon-maskable-512.png", optimize=True)

    master.save(
        ROOT / "app-icon.ico",
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
    )

    with Image.open(ROOT / "app-icon.ico") as icon:
        assert icon.ico.sizes() == {(size, size) for size in ICO_SIZES}
        for size in ICO_SIZES:
            frame = icon.ico.getimage((size, size))
            assert frame.size == (size, size)
            assert frame.convert("RGBA").getchannel("A").getextrema() == (255, 255)

    print(f"Master: {master.width} x {master.height}; ICO sizes: {ICO_SIZES}")
    print(f"PNG sizes: {PNG_SIZES}")
    print(f"Apple touch: 180 x 180; maskable: 512 x 512; padding color: {background}")


if __name__ == "__main__":
    main()
