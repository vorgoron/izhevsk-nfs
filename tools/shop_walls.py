#!/usr/bin/env python3
"""Пересадить вывески (shops) в public/city.json на стены по правилам fetch_city.shop_signs, без пересборки города
и без OSM: место вывески — точка на её нынешней стене, сдвинутая на 0,5 м внутрь дома.

  python3 tools/shop_walls.py
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import fetch_city  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "city.json")


def main():
    with open(OUT, encoding="utf-8") as f:
        city = json.load(f)
    old = city["shops"]
    pois = [(x - math.sin(a) * 0.5, z - math.cos(a) * 0.5, k, text) for x, z, a, _, _, k, text in old]
    new = fetch_city.shop_signs(city["buildings"], city["roads"], city["roadNodes"], pois)
    moved = sum(1 for s in new if (s[4], round(s[2], 1)) not in {(o[4], round(o[2], 1)) for o in old if o[6] == s[6]})
    print(f"shops: {len(old)} -> {len(new)}, на другую стену: {moved}")
    city["shops"] = new
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(city, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
