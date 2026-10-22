from pathlib import Path
from PIL import Image, ImageOps

source = Path("assets/IMG_5856.png")
target = Path("assets/harmex-tv.webp")
if not source.exists():
    raise SystemExit("HARMEX source image is missing")
with Image.open(source) as img:
    img = ImageOps.exif_transpose(img)
    img.thumbnail((1100, 1100), Image.Resampling.LANCZOS)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    img.save(target, "WEBP", quality=78, method=6)
print(f"HARMEX optimized: {source.stat().st_size:,} -> {target.stat().st_size:,} bytes")
