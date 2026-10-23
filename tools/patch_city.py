#!/usr/bin/env python3
"""Дописать в готовый public/city.json данные из кеша OSM (data/raw), без пересборки города:
buses и trolleys — маршруты автобусов и троллейбусов (узлы маршрутов находятся среди roadNodes по координатам),
cranes — краны на стройках.

  python3 tools/patch_city.py            # всё
  python3 tools/patch_city.py cranes     # только краны
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import fetch_city  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "city.json")


def node_index(city):
    at = {tuple(p): i for i, p in enumerate(city["roadNodes"])}
    index = {}
    for nid, (lat, lon) in fetch_city.nodes.items():
        i = at.get(fetch_city.project(lat, lon))
        if i is not None:
            index[nid] = i
    return index


def buses(city):
    return fetch_city.bus_routes(node_index(city))


def trolleys(city):
    return fetch_city.bus_routes(node_index(city), "trolleybus")


def cranes(city):
    xmin, zmin, xmax, zmax = city["bounds"]
    m = 300

    def inside(pts):
        return any(xmin - m < x < xmax + m and zmin - m < z < zmax + m for x, z in pts)
    return fetch_city.construction_cranes(inside, city["roads"], city["roadNodes"], city["buildings"], city["landmarks"])


PARTS = {"buses": buses, "trolleys": trolleys, "cranes": cranes}


def main():
    want = sys.argv[1:] or list(PARTS)
    with open(OUT, encoding="utf-8") as f:
        city = json.load(f)
    for path in sorted(glob.glob(os.path.join(fetch_city.RAW, "*.xml"))):
        with open(path, "rb") as f:
            fetch_city.parse_osm(f.read())
    for k in want:
        city[k] = PARTS[k](city)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(city, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
