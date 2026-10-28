#!/usr/bin/env python3
"""Склейка снимков окна Blender по два в ряд (поля окна обрезаются): montage.py <папка> out.png имя…
(имя — без .png, как в blender_shots.py: largus-fr, elargus-rear…)."""
import sys
from PIL import Image

d, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
ims = [Image.open(f'{d}/{n}.png') for n in names]
W, H = ims[0].size
ims = [i.crop((int(W * .1), int(H * .05), int(W * .9), int(H * .95))).resize((900, int(900 * H * .9 / (W * .8)))) for i in ims]
h = ims[0].size[1]
c = Image.new('RGB', (1800, (len(ims) + 1) // 2 * h))
for k, i in enumerate(ims): c.paste(i, (k % 2 * 900, k // 2 * h))
c.save(out)
