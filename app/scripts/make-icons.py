#!/usr/bin/env python3
"""Значки .ico двух программ (этап М5, ADR-0003 4.4, docs/stil-k1.md).

Ученик: оранжевый квадрат #FF5B14, контур и жёсткая тень #111, «K1» JetBrains Mono 800, «1» чуть ниже, как индекс.
Тьютор: тот же знак на чёрной плитке, контур и тень белые, сверху оранжевая полоса, как «ТЬЮТОР» в программе (с 32 px).
Запуск из папки app:  python3 scripts/make-icons.py
Нужны Pillow и fontTools (шрифт берётся из desktop/vitrina/ui/fonts, woff2 разворачивается в память).
Выход: build/icon.ico, build/tutor/icon.ico и PNG 256 px рядом (для README).
"""
import io
from pathlib import Path
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parent.parent
FONT = APP / 'desktop' / 'vitrina' / 'ui' / 'fonts' / 'jetbrains-mono-latin.woff2'
SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
INK = (17, 17, 17, 255)
WHITE = (255, 255, 255, 255)
ACCENT = (255, 91, 20, 255)
K = 8  # рисуем в 8 раз крупнее и уменьшаем


def font_bytes():
    f = TTFont(str(FONT))
    f.flavor = None
    buf = io.BytesIO()
    f.save(buf)
    return buf.getvalue()


TTF = font_bytes()


def mono(px):
    f = ImageFont.truetype(io.BytesIO(TTF), px)
    try:
        f.set_variation_by_axes([800])
    except Exception:
        pass
    return f


def mark(d, box, line, shadow, edge):
    """Знак K1 в квадрате box = (x, y, side): тень, заливка, контур, буквы."""
    x, y, a = box
    d.rectangle([x + shadow, y + shadow, x + a + shadow - 1, y + a + shadow - 1], fill=edge)
    d.rectangle([x, y, x + a - 1, y + a - 1], fill=ACCENT, outline=edge, width=line)
    f = mono(int(a * 0.46))
    k_w = d.textlength('K', font=f)
    one_w = d.textlength('1', font=f)
    total = k_w + one_w
    left = x + (a - total) / 2
    top = y + a * 0.5
    d.text((left, top), 'K', font=f, fill=INK, anchor='lm')
    d.text((left + k_w, top + a * 0.07), '1', font=f, fill=INK, anchor='lm')


def student(n):
    s = n * K
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    line = max(K, round(s * 0.045))
    shadow = max(K, round(s * 0.07))
    a = s - shadow - line
    mark(d, (line // 2, line // 2, a), line, shadow, INK)
    return img.resize((n, n), Image.LANCZOS)


def tutor(n):
    s = n * K
    img = Image.new('RGBA', (s, s), INK)
    d = ImageDraw.Draw(img)
    pad = 0
    if n >= 32:
        stripe = round(s * 0.16)
        d.rectangle([0, 0, s - 1, stripe - 1], fill=ACCENT)
        d.rectangle([0, stripe, s - 1, stripe + max(K, round(s * 0.02)) - 1], fill=INK)
        pad = stripe
    line = max(K, round(s * 0.04))
    shadow = max(K, round(s * 0.06))
    room = s - pad
    a = round(room * 0.72)
    x = (s - a - shadow) // 2
    y = pad + (room - a - shadow) // 2
    mark(d, (x, y, a), line, shadow, WHITE)
    return img.resize((n, n), Image.LANCZOS)


def save(draw, out):
    out.parent.mkdir(parents=True, exist_ok=True)
    images = [draw(n) for n in SIZES]
    big = images[-1]
    big.save(out, format='ICO', sizes=[(n, n) for n in SIZES], append_images=images[:-1])
    big.save(out.with_suffix('.png'))
    print(out.relative_to(APP), ', '.join(str(n) for n in SIZES))


if __name__ == '__main__':
    save(student, APP / 'build' / 'icon.ico')
    save(tutor, APP / 'build' / 'tutor' / 'icon.ico')
