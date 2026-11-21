"""Иконки «Калькулятора»: тёмный фон, три строки расчёта, последняя — зелёная с «=»."""
import sys
from PIL import Image, ImageDraw

out = sys.argv[1]
BG, LINE, ACC = (22, 27, 34), (125, 133, 144), (63, 185, 80)


def draw(size, maskable):
    s = 4  # рисуем крупнее и уменьшаем — сглаживание
    W = size * s
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, W, W], fill=BG)
        pad = W * 0.22
    else:
        d.rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.22, fill=BG)
        pad = W * 0.17
    inner = W - 2 * pad
    h = inner * 0.12
    r = h / 2
    rows = [(0.35, LINE), (0.55, LINE)]
    y = pad + inner * 0.12
    for frac, col in rows:
        d.rounded_rectangle([pad + inner * (1 - frac), y, pad + inner, y + h], radius=r, fill=col)
        y += inner * 0.22
    # последняя строка: «= результат» зелёным
    y += inner * 0.04
    eq_w, gap = inner * 0.2, inner * 0.06
    for k in (0, 1):
        yy = y + k * h * 0.95
        d.rounded_rectangle([pad, yy, pad + eq_w, yy + h * 0.55], radius=h * 0.27, fill=ACC)
    d.rounded_rectangle([pad + eq_w + gap, y - h * 0.2, pad + inner, y + h * 1.75], radius=h * 0.55, fill=ACC)
    return img.resize((size, size), Image.LANCZOS)


draw(192, False).save(f'{out}/icon-192.png')
draw(512, False).save(f'{out}/icon-512.png')
draw(512, True).save(f'{out}/icon-maskable.png')
