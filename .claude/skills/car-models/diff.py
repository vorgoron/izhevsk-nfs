#!/usr/bin/env python3
"""Сравнение двух снимков стенда: сколько пикселей отличаются заметно (больше 40 из 255).
diff.py было.png стало.png [разница.png] — разница.png: белым отличающиеся пиксели (пишется, если они есть)."""
import sys
from PIL import Image, ImageChops

a, b = (Image.open(p).convert('RGB') for p in sys.argv[1:3])
d = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 40 else 0)
n = sum(1 for v in d.getdata() if v)
print(n, d.getbbox() or '')
if n and len(sys.argv) > 3: d.save(sys.argv[3])
