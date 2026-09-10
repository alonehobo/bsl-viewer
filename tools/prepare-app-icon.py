"""Prepare transparent PNG and multi-resolution ICO from the generated artwork."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "app-icon-generated.png"
PNG_OUTPUT = ROOT / "assets" / "app-icon.png"
ICO_OUTPUT = ROOT / "assets" / "app-icon.ico"

# The generator returned a checkerboard preview around the actual rounded tile.
# These coordinates isolate the tile while keeping a small transparent safe area.
CROP_BOX = (64, 64, 1190, 1190)
TILE_BOX = (45, 45, 1081, 1081)
TILE_RADIUS = 208


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA").crop(CROP_BOX)

    mask = Image.new("L", source.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        TILE_BOX,
        radius=TILE_RADIUS,
        fill=255,
    )
    source.putalpha(mask)

    icon = source.resize((1024, 1024), Image.Resampling.LANCZOS)
    icon.save(PNG_OUTPUT, optimize=True)
    icon.save(
        ICO_OUTPUT,
        format="ICO",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40),
               (48, 48), (64, 64), (96, 96), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
