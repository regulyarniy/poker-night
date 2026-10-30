"""Генератор PNG-иконок PWA (docs/SPEC.md §10.3).

Иконки рисуются кодом, а не кладутся бинарниками: набор всегда воспроизводим.
Запуск: python tools/gen-icons.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"

BG_TOP = (23, 53, 42)
BG_BOTTOM = (13, 21, 18)
GOLD = (212, 175, 55)
GOLD_LIGHT = (232, 201, 90)
GOLD_DARK = (184, 147, 42)
FELT = (23, 53, 42)


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (size, size), top)
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (size, y)], fill=color)
    return image


def draw_chip(image: Image.Image, center: tuple[float, float], radius: float, inset: bool) -> None:
    """Покерная фишка: золотое кольцо, восемь секторов, центр с номиналом."""
    draw = ImageDraw.Draw(image, "RGBA")
    cx, cy = center

    # Мягкая тень под фишкой.
    draw.ellipse(
        [cx - radius * 1.04, cy - radius * 0.96 + radius * 0.12, cx + radius * 1.04, cy + radius * 1.04 + radius * 0.12],
        fill=(0, 0, 0, 70),
    )

    # Тело фишки.
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=FELT)

    # Восемь золотых секторов по ободу.
    sectors = 8
    band_outer = radius * 0.99
    band_inner = radius * 0.78
    for i in range(sectors):
        start = (360 / sectors) * i + 8
        end = start + (360 / sectors) - 16
        draw.arc(
            [cx - band_outer, cy - band_outer, cx + band_outer, cy + band_outer],
            start=start,
            end=end,
            fill=GOLD,
            width=max(2, round(radius * 0.16)),
        )

    # Внутреннее кольцо.
    ring = radius * 0.66
    draw.ellipse(
        [cx - ring, cy - ring, cx + ring, cy + ring],
        outline=GOLD_LIGHT,
        width=max(2, round(radius * 0.05)),
    )

    # Символ: две карты (пика) — узнаваемо и без текста.
    card_w = radius * 0.30
    card_h = radius * 0.44
    for dx, dy, angle in ((-radius * 0.12, radius * 0.02, -14), (radius * 0.12, -radius * 0.02, 14)):
        _rotated_card(draw, (cx + dx, cy + dy), card_w, card_h, angle)

    if inset:
        # Дополнительный контур для maskable — безопасная зона.
        margin = radius * 0.5
        draw.ellipse(
            [margin, margin, image.width - margin, image.height - margin],
            outline=(0, 0, 0, 0),
        )


def _rotated_card(
    draw: ImageDraw.ImageDraw,
    center: tuple[float, float],
    width: float,
    height: float,
    angle_deg: float,
) -> None:
    cx, cy = center
    angle = math.radians(angle_deg)
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    corners = [
        (-width / 2, -height / 2),
        (width / 2, -height / 2),
        (width / 2, height / 2),
        (-width / 2, height / 2),
    ]
    points = [
        (cx + x * cos_a - y * sin_a, cy + x * sin_a + y * cos_a) for x, y in corners
    ]
    draw.polygon(points, fill=(242, 240, 235, 235), outline=GOLD_DARK)


def build(size: int, *, maskable: bool) -> Image.Image:
    image = vertical_gradient(size, BG_TOP, BG_BOTTOM).convert("RGBA")
    # Радиальный «фетр» сверху.
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    steps = 24
    for i in range(steps, 0, -1):
        r = size * 0.62 * i / steps
        alpha = round(10 + 2 * (steps - i))
        glow_draw.ellipse(
            [size / 2 - r, -size * 0.18 - r * 0.4, size / 2 + r, -size * 0.18 + r * 0.9],
            fill=(23, 53, 42, alpha),
        )
    image = Image.alpha_composite(image, glow)

    if maskable:
        # Maskable: фишка меньше, чтобы её не срезало любой маской.
        radius = size * 0.30
    else:
        radius = size * 0.36
    draw_chip(image, (size / 2, size / 2), radius, inset=maskable)
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    targets = [
        ("192.png", 192, False),
        ("512.png", 512, False),
        ("maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
    ]
    for name, size, maskable in targets:
        image = build(size, maskable=maskable)
        path = OUT / name
        image.convert("RGB").save(path, "PNG", optimize=True)
        print(f"{path.name}: {size}x{size}")


if __name__ == "__main__":
    main()
