#!/usr/bin/env python3
"""Дописать в готовый public/city.json данные из кеша OSM (data/raw), без пересборки города:
buses и trolleys — маршруты автобусов и троллейбусов (узлы маршрутов находятся среди roadNodes по координатам),
cranes — краны на стройках, towers — высокое по точкам (вышки, трубы, опоры ЛЭП).

  python3 tools/patch_city.py            # всё
  python3 tools/patch_city.py cranes     # только краны
"""
import glob
import json
import math
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


def towers(city):
    xmin, zmin, xmax, zmax = city["bounds"]
    m = 300
    return fetch_city.tall_things(lambda pts: any(xmin - m < x < xmax + m and zmin - m < z < zmax + m for x, z in pts))["towers"]


def ruins(city):
    """Аварийные и ветхие дома по ГИС ЖКХ (data/raw/gis_izhevsk.json, поле st) — флаг ru у домов того же адреса."""
    gis = {}
    with open(fetch_city.GIS, encoding="utf-8") as f:
        for h in json.load(f):
            if h.get("st"):
                gis[fetch_city.addr_key(h["s"], h["n"])] = h
    rings = fetch_city.izhevsk_rings()
    n = 0
    for b in city["buildings"]:
        b.pop("ru", None)
        if "a" in b and "st" in b and not b.get("lm") and not b.get("pw") and b["s"] not in (3, 4, 5):
            if fetch_city.addr_key(city["streets"][b["st"]], b["a"]) in gis and any(fetch_city.point_in(*b["p"][0], r) for r in rings):
                b["ru"] = 1
                n += 1
    print(f"ruins: {n} домов (в ГИС {len(gis)} адресов)")
    return city["buildings"]


def fences(city):
    """Переопределения заборов (fetch_city.FENCE_OVERRIDE): куски, лежащие на этом пути OSM, — заново по нему целиком."""
    n = 0
    for wid in fetch_city.FENCE_OVERRIDE:
        if wid not in fetch_city.ways:
            continue
        way = [fetch_city.project(*fetch_city.nodes[i]) for i in fetch_city.ways[wid][0] if i in fetch_city.nodes]
        segs = list(zip(way, way[1:]))

        def on(x, z):
            for (ax, az), (bx, bz) in segs:
                dx, dz = bx - ax, bz - az
                t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz or 1)))
                if math.hypot(ax + dx * t - x, az + dz * t - z) < 0.3:
                    return True
            return False
        old = len(city["fences"])
        city["fences"] = [f for f in city["fences"] if not all(on(x, z) for x, z in f["p"])]
        gone = old - len(city["fences"])
        new = fetch_city.override_fence(wid, way)
        city["fences"] += new
        n += 1
        print(f"fences: way {wid} — {gone} кусков заменены на {len(new)}")
    return city["fences"]


PARTS = {"buses": buses, "trolleys": trolleys, "cranes": cranes, "towers": towers, "buildings": ruins, "fences": fences}


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
