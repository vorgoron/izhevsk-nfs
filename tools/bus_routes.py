#!/usr/bin/env python3
"""Дописать маршруты автобусов (buses) в public/city.json из кеша OSM (data/raw), без пересборки города: узлы
маршрутов находятся среди roadNodes по координатам.

  python3 tools/bus_routes.py
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import fetch_city  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "city.json")


def main():
    with open(OUT, encoding="utf-8") as f:
        city = json.load(f)
    for path in sorted(glob.glob(os.path.join(fetch_city.RAW, "*.xml"))):
        with open(path, "rb") as f:
            fetch_city.parse_osm(f.read())
    at = {tuple(p): i for i, p in enumerate(city["roadNodes"])}
    index = {}
    for nid, (lat, lon) in fetch_city.nodes.items():
        i = at.get(fetch_city.project(lat, lon))
        if i is not None:
            index[nid] = i
    city["buses"] = fetch_city.bus_routes(index)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(city, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
