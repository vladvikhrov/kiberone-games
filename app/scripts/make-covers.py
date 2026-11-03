#!/usr/bin/env python3
"""Обложки 1280x800 для Киберпочты, Сейфа и тестовой игры с режимами.

Стиль docs/stil-k1.md: пастельный фон из макета, рисунок чёрными линиями, без градиентов и теней с размытием.
Запуск из папки app:  python3 scripts/make-covers.py
Нужен Pillow. Рисуем в 2 раза крупнее и уменьшаем, чтобы линии были гладкими.
"""
from pathlib import Path
from PIL import Image, ImageDraw

W, H, K = 1280, 800, 2
INK = (17, 17, 17)
WHITE = (255, 255, 255)
APP = Path(__file__).resolve().parent.parent
GAMES = APP.parent / 'games'


def canvas(bg):
    img = Image.new('RGB', (W * K, H * K), bg)
    return img, ImageDraw.Draw(img)


def s(*xs):
    return [x * K for x in xs]


def line(d, pts, w=12):
    d.line(s(*pts), fill=INK, width=w * K, joint='curve')


def rect(d, x0, y0, x1, y1, w=12, fill=WHITE):
    d.rectangle(s(x0, y0, x1, y1), fill=fill, outline=INK, width=w * K)


def shadow_rect(d, x0, y0, x1, y1, w=12, off=20, fill=WHITE):
    d.rectangle(s(x0 + off, y0 + off, x1 + off, y1 + off), fill=INK)
    rect(d, x0, y0, x1, y1, w, fill)


def circle(d, cx, cy, r, w=12, fill=WHITE):
    d.ellipse(s(cx - r, cy - r, cx + r, cy + r), fill=fill, outline=INK, width=w * K)


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((W, H), Image.LANCZOS).quantize(colors=48, dither=Image.Dither.NONE).save(path, optimize=True)
    size = path.stat().st_size
    assert size <= 512 * 1024, f'{path}: {size} байт, больше 512 КБ'
    print(f'{path.relative_to(APP.parent)}: {size // 1024} КБ')


# Окно игры показывает обложку полосой 3:1, поэтому весь рисунок держим в полосе y 200–600.
def kiberpochta():
    img, d = canvas((0xF5, 0xC6, 0xB8))
    # Письмо с жёсткой тенью
    shadow_rect(d, 330, 230, 790, 570)
    line(d, [330, 230, 560, 420, 790, 230])
    line(d, [330, 570, 495, 410])
    line(d, [790, 570, 625, 410])
    # Крючок мошенника опускается сверху к письму
    line(d, [960, 0, 960, 420])
    d.arc(s(840, 360, 960, 480), 0, 180, fill=INK, width=12 * K)
    line(d, [840, 420, 840, 350])
    line(d, [840, 350, 880, 390])
    return img


def seif():
    img, d = canvas((0xC9, 0xE4, 0xC5))
    shadow_rect(d, 300, 200, 760, 590)
    rect(d, 345, 245, 715, 545, w=8, fill=(0xF0, 0xF2, 0xF3))
    # Кодовый диск с рисками
    circle(d, 510, 395, 105)
    circle(d, 510, 395, 22, w=10)
    for x0, y0, x1, y1 in [(510, 290, 510, 322), (510, 468, 510, 500), (405, 395, 437, 395), (583, 395, 615, 395)]:
        line(d, [x0, y0, x1, y1], w=10)
    line(d, [670, 330, 670, 460], w=16)  # ручка
    # Лампочки 1011: двоичный код замка
    for i, on in enumerate([1, 0, 1, 1]):
        cx = 870 + i * 90
        circle(d, cx, 360, 32, w=10, fill=INK if on else WHITE)
        line(d, [cx, 392, cx, 450], w=8)
    line(d, [870, 450, 1140, 450], w=8)
    return img


def tri_cover():
    img, d = canvas((0xE3, 0xCB, 0xEA))
    for i, x in enumerate([330, 560, 790]):
        shadow_rect(d, x, 300, x + 160, 460)
        for j in range(i + 1):  # одна, две, три точки
            circle(d, x + 80, 380 + (j - i / 2) * 44, 13, w=1, fill=INK)
    return img


def tri_training():
    img, d = canvas((0xBF, 0xD8, 0xF0))
    shadow_rect(d, 300, 220, 980, 580)
    line(d, [400, 320, 580, 320, 580, 480, 880, 480])
    line(d, [840, 440, 880, 480, 840, 520])
    rect(d, 360, 285, 430, 355, w=10)
    return img


def tri_timed():
    img, d = canvas((0xF2, 0xD6, 0xA2))
    d.ellipse(s(480 + 16, 250 + 16, 800 + 16, 570 + 16), fill=INK)
    circle(d, 640, 410, 160)
    line(d, [640, 300, 640, 410, 715, 460], w=14)
    line(d, [600, 215, 680, 215], w=14)
    line(d, [640, 215, 640, 250], w=14)
    return img


if __name__ == '__main__':
    save(kiberpochta(), GAMES / 'kiberpochta' / 'cover.png')
    save(seif(), GAMES / 'vzlomai-seif' / 'cover.png')
    tri = APP / 'testgames' / 'tri-rezhima'
    save(tri_cover(), tri / 'cover.png')
    save(tri_training(), tri / 'cover-training.png')
    save(tri_timed(), tri / 'cover-timed.png')
