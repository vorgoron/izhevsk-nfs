#!/usr/bin/env python3
"""Скачивает OSM и рельеф для центра Ижевска и собирает public/city.json.

Источники:
  - OSM: основной API (api/0.6/map), тайлами — Overpass часто лежит.
  - Рельеф: тайлы высот Terrarium (AWS Terrain Tiles, источник — SRTM и др.).
Сырые ответы кешируются в data/raw/, повторный запуск ничего не качает.

Запуск: python3 tools/fetch_city.py
"""
import collections
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "public", "city.json")

# Область: AREA=city (по умолчанию) — застроенный Ижевск, AREA=center — только центр (быстро,
# для отладки). Сетка тайлов OSM привязана к одной точке, так что кеш центра годится и для города.
AREAS = {
    "center": (56.835, 56.862, 53.175, 53.235),  # пруд, плотина, Центральная площадь, Пушкинская
    "city": (56.7756, 56.9268, 53.075, 53.335),  # ~16 × 17 км
}
AREA = os.environ.get("AREA", "city")
SOUTH, NORTH, WEST, EAST = AREAS[AREA]
LAT0, LON0 = 56.8495, 53.2045  # ~ Центральная площадь
TILE_LON, TILE_LAT = 0.01, 0.0054
DEM_STEP = 30.0  # метров между точками сетки рельефа (тайлы Terrarium ~10 м/пиксель, данные SRTM ~30 м)

UA = "izhevsk-nfs-prototype/0.1 (personal hobby project)"

M_PER_DEG_LAT = 111132.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))


def project(lat, lon):
    """lat/lon -> локальные метры: x на восток, z на юг (как в three.js)."""
    return (round((lon - LON0) * M_PER_DEG_LON, 2), round(-(lat - LAT0) * M_PER_DEG_LAT, 2))


def unproject(x, z):
    return (LAT0 - z / M_PER_DEG_LAT, LON0 + x / M_PER_DEG_LON)


def fetch(url, cache_name, data=None, pause=0.5):
    path = os.path.join(RAW, cache_name)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                body = r.read()
            with open(path, "wb") as f:
                f.write(body)
            time.sleep(pause)
            return body
        except Exception as e:  # noqa: BLE001 — сетевые ошибки любые, просто ретраим
            print(f"  ! {e}, retry {attempt + 1}", file=sys.stderr)
            time.sleep(20 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}")


# ---------------------------------------------------------------- OSM

nodes = {}      # id -> (lat, lon)
node_tags = {}  # id -> tags (только для узлов с тегами)
ways = {}       # id -> (node_ids, tags)
relations = {}  # id -> (members[(type, ref, role)], tags)


def parse_osm(xml_bytes):
    root = ET.fromstring(xml_bytes)
    for el in root:
        if el.tag == "node":
            nid = int(el.get("id"))
            nodes[nid] = (float(el.get("lat")), float(el.get("lon")))
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if tags:
                node_tags[nid] = tags
        elif el.tag == "way":
            wid = int(el.get("id"))
            nds = [int(n.get("ref")) for n in el.findall("nd")]
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            ways[wid] = (nds, tags)
        elif el.tag == "relation":
            rid = int(el.get("id"))
            members = [(m.get("type"), int(m.get("ref")), m.get("role")) for m in el.findall("member")]
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            relations[rid] = (members, tags)


def download_osm():
    nx = math.ceil((EAST - WEST) / TILE_LON - 1e-9)
    ny = math.ceil((NORTH - SOUTH) / TILE_LAT - 1e-9)
    total = nx * ny
    k = 0
    for i in range(nx):
        for j in range(ny):
            k += 1
            w = WEST + i * TILE_LON
            s = SOUTH + j * TILE_LAT
            e = min(EAST, w + TILE_LON)
            n = min(NORTH, s + TILE_LAT)
            bbox = f"{w:.4f},{s:.4f},{e:.4f},{n:.4f}"
            print(f"OSM tile {k}/{total} {bbox}")
            body = fetch(f"https://api.openstreetmap.org/api/0.6/map?bbox={bbox}", f"osm_{bbox}.xml")
            parse_osm(body)

    # Мультиполигоны (пруд, парки) часто выходят за bbox — докачиваем целиком.
    for rid, (members, tags) in list(relations.items()):
        if tags.get("type") != "multipolygon" or not area_kind(tags):
            continue
        if any(t == "way" and ref not in ways for t, ref, _ in members):
            print(f"OSM relation {rid} full ({tags.get('name', '')})")
            parse_osm(fetch(f"https://api.openstreetmap.org/api/0.6/relation/{rid}/full", f"rel_{rid}.xml"))


# ---------------------------------------------------------------- классификация

ROAD_WIDTH = {
    "motorway": 16, "trunk": 14, "primary": 13, "secondary": 11, "tertiary": 9,
    "unclassified": 6.5, "residential": 6.5, "living_street": 5.5, "service": 4.5,
    "motorway_link": 7, "trunk_link": 7, "primary_link": 7, "secondary_link": 6.5, "tertiary_link": 6,
    "pedestrian": 6, "road": 6,
}
PATHS = {"footway", "path", "steps", "cycleway", "track", "bridleway", "corridor"}
# Особые пешеходные мосты: level — точка в сторону, где земля поднимается до настила
# (мост выходит на площадь вровень), stairs — лестница вниз с противоположного конца.
FOOTBRIDGE_STYLE = {
    106782602: {"level": [0, 0], "stairs": 1},  # с Центральной площади над Карла Маркса к Максима Горького
}
FOOTBRIDGE_W = {"footway": 3.0, "path": 2.5, "steps": 2.5, "cycleway": 3.0, "track": 3.5, "pedestrian": 6.0}


def osm_name(tags):
    """Название: name, а если его нет — name:ru (так размечена, например, часть Советской)."""
    return tags.get("name") or tags.get("name:ru") or ""


def road_width(tags):
    hw = tags["highway"]
    w = ROAD_WIDTH.get(hw, 6)
    try:
        lanes = float(tags.get("lanes", "").split(";")[0])
        w = max(w * 0.6, lanes * 3.3 + 1.0)
    except ValueError:
        pass
    if tags.get("oneway") == "yes" and "lanes" not in tags and hw not in ("service",):
        w *= 0.65
    return round(w, 1)


SHORT_TUNNEL = 60  # м: короче — проезд под пешеходным мостом/настилом, а не тоннель в земле


def is_tunnel(tags, pts):
    """Настоящий тоннель — под землёй. building_passage и tunnel без layer<0 в центре —
    арки и проезды под домами: это обычная дорога, арку прорежем в доме. Короткий тоннель —
    проезд под мостом (рельеф мы не вырезаем, так что это тоже обычная дорога)."""
    t = tags.get("tunnel")
    if t in (None, "no", "building_passage"):
        return False
    if sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts))) < SHORT_TUNNEL:
        return False
    return (parse_num(tags.get("layer")) or 0) < 0 and tags.get("covered") != "yes"


def is_forest(tags):
    """Лес (в браузере — в основном ели), а не парк/сквер."""
    return tags.get("landuse") == "forest" or tags.get("natural") == "wood"


def area_kind(tags):
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in ("reservoir", "basin"):
        return "water"
    if tags.get("leisure") in ("park", "garden") or tags.get("landuse") in ("forest", "recreation_ground", "village_green", "cemetery") \
            or tags.get("natural") in ("wood", "scrub"):
        return "park"
    if tags.get("leisure") == "track" and tags.get("sport", "running") in ("running", "athletics"):
        return "track"  # беговая дорожка — красная
    if tags.get("landuse") in ("grass", "meadow") or tags.get("natural") in ("grassland", "heath") \
            or tags.get("leisure") in ("pitch", "stadium"):
        return "grass"
    if tags.get("natural") in ("sand", "beach"):
        return "sand"
    if tags.get("landuse") in ("industrial", "railway", "garages", "construction"):
        return "industrial"
    if tags.get("place") == "square" or (tags.get("highway") == "pedestrian" and tags.get("area") == "yes") \
            or tags.get("amenity") in ("parking", "fuel"):
        return "paved"
    return None


DEFAULT_LEVELS = {
    "apartments": 9, "residential": 5, "house": 1.5, "detached": 1.5, "dormitory": 5,
    "commercial": 3, "retail": 2, "office": 5, "industrial": 3, "warehouse": 2,
    "garage": 1, "garages": 1, "shed": 1, "roof": 1, "kiosk": 1, "service": 1,
    "stadium": 4, "grandstand": 3, "sports_hall": 3,
    "church": 2, "chapel": 1.5, "cathedral": 6, "school": 3, "kindergarten": 2, "university": 5,
    "hospital": 5, "public": 4, "civic": 4, "hotel": 8, "train_station": 3,
}


def parse_num(s):
    try:
        return float(s.replace(",", ".").replace("m", "").strip().split(";")[0])
    except (ValueError, AttributeError):
        return None


# Ограничение скорости из maxspeed, км/ч: число, «60 mph» или зона «RU:urban» (ПДД: город 60, вне — 90,
# жилая зона 20, автомагистраль 110). Непонятное — None (в игре — 60 км/ч).
MAXSPEED_ZONES = {"urban": 60, "rural": 90, "living_street": 20, "motorway": 110}


def maxspeed_kmh(tags):
    v = (tags.get("maxspeed") or "").strip()
    if not v:
        return None
    if ":" in v:
        return MAXSPEED_ZONES.get(v.split(":", 1)[1])
    n = parse_num(v.replace("mph", ""))
    if not n:
        return None
    return int(round(n * 1.609)) if "mph" in v else int(n)


# Достопримечательности: в браузере у них своя модель (replace), своя окраска
# и надстройка поверх обычной коробки (recolor) или отдельный объект рядом (add).
LANDMARKS = {
    "mikhailovsky": ("way", 28988606, "Свято-Михайловский собор", "replace"),
    "nevsky": ("way", 151492280, "Александро-Невский собор", "replace"),
    "troitsky": ("way", 453556944, "Свято-Троицкий собор", "replace"),
    "kazansky": ("way", 63069081, "Храм Казанской иконы Божией Матери", "replace"),
    "ddn": ("way", 56631030, "Дом дружбы народов", "replace"),
    "residence": ("way", 63071824, "Резиденция Главы Удмуртской Республики", "replace"),
    "friendship": ("way", 442350429, "Монумент «Навеки с Россией»", "replace"),
    "rotunda": ("way", 446870127, "Ротонда", "replace"),
    "mosque": ("way", 146942052, "Центральная мечеть", "replace"),
    "circus": ("way", 54951726, "Государственный цирк", "replace"),
    "column": ("node", 2348003718, "Михайловская колонна", "replace"),
    "plant_tower": ("node", 5294741728, "Башня оружейного завода", "add"),
    "flame": ("node", 1259897102, "Вечный огонь", "add"),
    "wheel": ("node", 4891749969, "Колесо обозрения в Летнем саду", "add"),
    "arsenal": ("relation", 389556, "Арсенал — Национальный музей", "recolor"),
    "government": ("way", 63071820, "Дом правительства", "recolor"),
    "opera": ("way", 152841852, "Театр оперы и балета", "recolor"),
    "kalashnikov": ("way", 29032752, "Музей Калашникова", "recolor"),
}
LANDMARK_BY_ELEMENT = {(t, i): key for key, (t, i, _, _) in LANDMARKS.items()}


def landmark_entries():
    out = []
    for key, (etype, eid, name, mode) in LANDMARKS.items():
        pts = None
        if etype == "node":
            if eid not in nodes:
                print(f"  ! landmark {key}: node {eid} not found", file=sys.stderr)
                continue
            x, z = project(*nodes[eid])
        else:
            if etype == "way" and eid in ways:
                pts = ring_xy(ways[eid][0])
            elif etype == "relation" and eid in relations:
                outer = [ways[r][0] for t, r, role in relations[eid][0] if t == "way" and r in ways and role == "outer"]
                rings = stitch(outer)
                pts = ring_xy(rings[0]) if rings else None
            if not pts:
                print(f"  ! landmark {key}: {etype} {eid} not found", file=sys.stderr)
                continue
            x = sum(p[0] for p in pts) / len(pts)
            z = sum(p[1] for p in pts) / len(pts)
        tags = (node_tags.get(eid) if etype == "node" else ways.get(eid, (0, {}))[1] if etype == "way"
                else relations.get(eid, (0, {}))[1]) or {}
        out.append({"key": key, "name": name, "mode": mode, "x": round(x, 2), "z": round(z, 2),
                    **({"p": pts} if pts else {}), **({"h": parse_num(tags["height"])} if "height" in tags else {})})
    return out


# Без этажности в тегах: маленький по площади дом — киоск/магазин/пристрой, не многоэтажка.
AREA_MAX_LEVELS = ((80, 1), (200, 2), (400, 3))


def building_height(tags, wid, area):
    h = parse_num(tags.get("height"))
    if h:
        return h
    lv = parse_num(tags.get("building:levels"))
    if lv:
        return lv * 3.1 + 1.0 + (2.0 if tags.get("roof:shape") not in (None, "flat") else 0)
    lv = DEFAULT_LEVELS.get(tags.get("building"), 4 + (wid % 3))
    for max_area, max_lv in AREA_MAX_LEVELS:
        if area < max_area:
            lv = min(lv, max_lv)
            break
    return lv * 3.1 + 1.0


def building_base(tags, h):
    """Высота низа: навесы, переходы и консоли над землёй (min_height, layer над дорогой)."""
    mh = parse_num(tags.get("min_height"))
    if mh is None:
        lv = parse_num(tags.get("building:min_level"))
        mh = lv * 3.1 if lv else 0.0
    if tags.get("building") == "roof":  # навес: тонкая плита на столбах
        mh = max(mh, h - 0.8)
    return round(mh, 1) if mh >= 1.5 and mh < h - 0.5 else 0.0


def is_raised(tags):
    """Дом целиком над землёй: переход между корпусами, дом-мост."""
    layer = parse_num(tags.get("layer")) or 0
    return tags.get("building") in ("bridge", "roof") or layer >= 1


PUBLIC_TAGS = {"commercial", "retail", "office", "school", "university", "college", "kindergarten", "hospital",
               "public", "civic", "government", "supermarket", "train_station", "hotel"}


def building_style(tags, wid, h, pts):
    """Серия фасада (в браузере — своя полоса текстуры и палитра):
    0 — панельная пятиэтажка, 1 — кирпичная хрущёвка, 2 — штукатурка (сталинка, старый центр), 3 — бетон/пром,
    4 — храм, 5 — глухой бетон (трибуны, навесы), 6 — частный дом (ставит mark_village_houses),
    7 — панельная девятиэтажка с лоджиями, 8 — кирпичный многоэтажный, 9 — новостройка, 10 — общественное здание,
    11 — малоэтажный послевоенный (2–3 этажа, штукатурка розовая/зелёная/горчичная, скатная крыша).
    Данных о фасадах в OSM почти нет: серия угадывается по этажности, форме контура и году, материал — если указан."""
    b = tags.get("building")
    if b in ("stadium", "grandstand"):
        return 5
    mat = tags.get("building:material", "")
    if tags.get("amenity") == "place_of_worship" and tags.get("religion", "christian") == "christian":
        return 4
    if b in ("church", "cathedral", "chapel"):
        return 2  # постройки при храме без отметки «храм» — обычный оштукатуренный дом
    if b in ("industrial", "warehouse", "garage", "garages", "shed", "service", "roof"):
        return 3
    n = round((h - 1) / 3.1)
    year = int(parse_num(tags.get("start_date", "")[:4]) or 0)
    w, L = obb_size(pts)
    r = wid % 100 / 100  # без данных — выбор по хешу, но детерминированно
    if b in PUBLIC_TAGS or tags.get("amenity") in ("school", "kindergarten", "hospital", "university", "college"):
        return 9 if n >= 8 or year >= 2000 else 10
    if year >= 1995 or n >= 17:
        return 9
    if mat in ("plaster", "wood"):
        return 2
    if n >= 12:
        return 9 if r < 0.5 else 7
    if n >= 8:
        if mat == "brick":
            return 8
        return 7 if mat in ("panel", "concrete") or r < 0.65 else 8
    if n >= 5 and L > 2 * w:
        # Хрущёвки и брежневки: длинные, 10–15 м шириной.
        if mat == "brick":
            return 1
        return 0 if mat in ("panel", "concrete") or r < 0.45 else 1
    # Двух-трёхэтажные многоквартирные — в Ижевске в основном послевоенные (Орджоникидзе, соцгорода).
    if 2 <= n <= 3 and w >= 8 and b in ("apartments", "residential", "dormitory"):
        return 11
    if n >= 3 and w > 9 and b in ("apartments", "residential", "yes", "dormitory"):
        return 2 if r < 0.6 else 1
    return 2 if wid % 3 else 1


# ---------------------------------------------------------------- геометрия

def stitch(way_lists):
    """Склеивает куски внешних колец мультиполигона по концам."""
    segs = [list(w) for w in way_lists if len(w) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[-2::-1]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def ring_xy(ids):
    pts = [project(*nodes[i]) for i in ids if i in nodes]
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def poly_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % len(pts)]
        a += x1 * z2 - x2 * z1
    return abs(a) / 2


def building_entry(pts, tags, eid, lm, holes=()):
    area = poly_area(pts) - sum(poly_area(h) for h in holes)
    h = round(building_height(tags, eid, area), 1)
    mh = building_base(tags, h)
    return {
        "p": pts, "h": h, "s": building_style(tags, eid, h, pts),
        **({"holes": [[(round(x, 2), round(z, 2)) for x, z in hole] for hole in holes]} if holes else {}),
        **({"mh": mh} if mh else {}),
        **({"name": osm_name(tags)} if osm_name(tags) else {}),
        **({"lm": lm} if lm else {}),
        # Православный/христианский храм без своей модели — в браузере главка на крыше.
        **({"pw": 1} if not lm and tags.get("amenity") == "place_of_worship"
           and tags.get("religion", "christian") == "christian" else {}),
        "_raised": is_raised(tags),
        "_auto_h": not (tags.get("height") or tags.get("building:levels")),  # высота выдумана, не из тегов
        "_btag": tags.get("building"),
        "_levels": parse_num(tags.get("building:levels")),
        "_area": poly_area(pts),
        "_tags": tags,
        "_id": eid,
    }


# ---------------------------------------------------------------- проезды под домами

DRIVE = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
         "living_street", "service", "road", "motorway_link", "trunk_link", "primary_link",
         "secondary_link", "tertiary_link"}
PASSAGE_H = 4.5  # высота арки / низ перехода над дорогой


def point_in(x, z, poly):
    ins = False
    for i in range(len(poly)):
        ax, az = poly[i]
        bx, bz = poly[i - 1]
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            ins = not ins
    return ins


def clip_half(poly, nx, nz, c):
    """Сазерленд — Ходжман: оставляет часть полигона, где nx*x + nz*z >= c."""
    out = []
    for i in range(len(poly)):
        p, q = poly[i - 1], poly[i]
        fp = nx * p[0] + nz * p[1] - c
        fq = nx * q[0] + nz * q[1] - c
        if fq >= 0:
            if fp < 0:
                t = fp / (fp - fq)
                out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
            out.append(q)
        elif fp >= 0:
            t = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def clip_region(poly, planes):
    for nx, nz, c in planes:
        if len(poly) < 3:
            return []
        poly = clip_half(poly, nx, nz, c)
    return poly if len(poly) >= 3 else []


def phantom_edges(piece, original):
    """Рёбра, по обе стороны которых нет исходного дома: склейки от отсечения вогнутого контура.
    Стен и коллизий на них быть не должно."""
    out = []
    for i in range(len(piece)):
        (ax, az), (bx, bz) = piece[i], piece[(i + 1) % len(piece)]
        L = math.hypot(bx - ax, bz - az)
        if L < 0.05:
            continue
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        ox, oz = (bz - az) / L * 0.05, -(bx - ax) / L * 0.05
        if not point_in(mx + ox, mz + oz, original) and not point_in(mx - ox, mz - oz, original):
            out.append(i)
    return out


def split_by_road(poly, cross):
    """Режет контур по коридору дороги. Возвращает (боковые куски, кусок над дорогой).
    У вогнутого дома куски могут содержать склейки нулевой ширины — их помечает phantom_edges."""
    (ix, iz), (ox, oz), hw = cross
    dx, dz = ox - ix, oz - iz
    L = math.hypot(dx, dz)
    dx, dz = dx / L, dz / L
    nx, nz = -dz, dx
    c = nx * (ix + ox) / 2 + nz * (iz + oz) / 2
    t0 = dx * ix + dz * iz - 1.0
    t1 = dx * ox + dz * oz + 1.0
    strip = [(nx, nz, c - hw), (-nx, -nz, -c - hw)]
    sides = [
        clip_region(poly, [(nx, nz, c + hw)]),
        clip_region(poly, [(-nx, -nz, -c + hw)]),
        clip_region(poly, strip + [(-dx, -dz, -t0)]),
        clip_region(poly, strip + [(dx, dz, t1)]),
    ]
    over = clip_region(poly, strip + [(dx, dz, t0), (-dx, -dz, -t1)])
    return [s for s in sides if poly_area(s) > 1.0], over


def cut_passages(buildings, roads, road_nodes):
    """Дорога сквозь дом: дом с layer>=1 поднимаем целиком (переход), в остальных — арка."""
    cell = 50.0
    grid = {}
    for bi, b in enumerate(buildings):
        xs = [p[0] for p in b["p"]]
        zs = [p[1] for p in b["p"]]
        b["_bb"] = (min(xs), min(zs), max(xs), max(zs))
        for i in range(int(min(xs) // cell), int(max(xs) // cell) + 1):
            for j in range(int(min(zs) // cell), int(max(zs) // cell) + 1):
                grid.setdefault((i, j), []).append(bi)

    # Для каждой пары (дом, дорога) — точки входа и выхода дороги из контура.
    hits = {}
    for ri, r in enumerate(roads):
        if r["k"] not in DRIVE or r["tu"]:
            continue
        pts = [road_nodes[n] for n in r["n"]]
        for a, b in zip(pts, pts[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            steps = max(1, int(L / 0.75))
            for k in range(steps + 1):
                x = a[0] + (b[0] - a[0]) * k / steps
                z = a[1] + (b[1] - a[1]) * k / steps
                for bi in grid.get((int(x // cell), int(z // cell)), ()):
                    bb = buildings[bi]["_bb"]
                    if bb[0] < x < bb[2] and bb[1] < z < bb[3] and point_in(x, z, buildings[bi]["p"]):
                        h = hits.setdefault((bi, ri), [None, None])
                        if h[0] is None:
                            h[0] = (x, z)
                        h[1] = (x, z)

    by_building = {}
    for (bi, ri), (pin, pout) in hits.items():
        if math.hypot(pout[0] - pin[0], pout[1] - pin[1]) < 1.5:
            continue  # дорога лишь царапает угол
        by_building.setdefault(bi, []).append((pin, pout, roads[ri]["w"] / 2 + 1.0))

    out, n_raised, n_arch, n_phantom = [], 0, 0, 0
    for bi, b in enumerate(buildings):
        crosses = by_building.get(bi)
        if crosses and not b.get("mh"):
            if b["_raised"]:
                b["mh"] = PASSAGE_H
                b["h"] = max(b["h"], PASSAGE_H + (0.8 if b.get("_fuel") else 3.0))
                n_raised += 1
            else:
                pieces = [(b["p"], 0.0)]
                for cross in crosses:
                    nxt = []
                    for poly, mh in pieces:
                        if mh:
                            nxt.append((poly, mh))
                            continue
                        sides, over = split_by_road(poly, cross)
                        nxt += [(s, 0.0) for s in sides]
                        # Низкий дом (гараж) — просто проём, высокий — арка с этажами над дорогой.
                        if over and b["h"] >= PASSAGE_H + 3.0:
                            nxt.append((over, PASSAGE_H))
                    pieces = nxt
                n_arch += 1
                for poly, mh in pieces:
                    piece = {k: v for k, v in b.items() if not k.startswith("_")}
                    piece["p"] = [(round(x, 2), round(z, 2)) for x, z in poly]
                    ph = phantom_edges(poly, b["p"])
                    if ph:
                        piece["x"] = ph  # рёбра без стен
                        n_phantom += 1
                    piece["g"] = bi  # куски одного дома: общий уровень крыши в браузере
                    if mh:
                        piece["mh"] = mh
                    out.append(piece)
                continue
        out.append({k: v for k, v in b.items() if not k.startswith("_")})
    print(f"passages: {n_raised} raised, {n_arch} arches ({n_phantom} pieces with phantom edges)")
    return out


# ---------------------------------------------------------------- трамваи

TRACK_HALF = 1.6   # м: половина междупутья (оси путей ~3.2 м)
TRACK_BLEND = 25.0  # м: от узла стыка/стрелки выравнивание нарастает до полного


def _tram_ways():
    return {wid: (nds, tags) for wid, (nds, tags) in ways.items()
            if tags.get("railway") == "tram" and not tags.get("service") and tags.get("tunnel") in (None, "no")}


def align_tram_tracks():
    """Два прохода выравнивания (второй уточняет по уже выровненным соседям), потом сглаживание."""
    tram = _tram_ways()
    # Узлы, общие с другим путём, и концы — стыки, стрелки, съезды на перекрёстках: они остаются
    # где в OSM, иначе соседние куски сдвигались по-разному и рельсы на стыке не сходились.
    # Служебные ветки (депо, кольца) не выравниваются, но их примыкание тоже закрепляем.
    use = collections.Counter(n for nds, tags in ways.values() if tags.get("railway") == "tram" for n in set(nds))
    # Путь, разрезанный в OSM без стыка (у моста, по смене тегов), — один путь: куски выравниваются
    # цепочкой, а не каждый от своих концов (под мостом на Карла Маркса пути расходились на 5 м).
    nds_of = {wid: [n for n in nds if n in nodes] for wid, (nds, _) in tram.items()}
    nds_of = {wid: nds for wid, nds in nds_of.items() if len(nds) >= 2}
    ends = collections.defaultdict(list)
    for wid, nds in nds_of.items():
        if nds[0] == nds[-1]:
            continue
        ends[nds[0]].append(wid)
        ends[nds[-1]].append(wid)
    cont = {n for n, ws in ends.items() if len(ws) == 2 and use[n] == 2}
    chains, seen = [], set()
    for wid in nds_of:
        if wid in seen:
            continue
        # Дойти до начала цепочки, потом собрать её вперёд.
        cur, rev = wid, True
        while True:
            n = nds_of[cur][0 if rev else -1]
            nxt = [w for w in ends[n] if w != cur] if n in cont else []
            if not nxt or nxt[0] == wid:
                break
            cur = nxt[0]
            rev = nds_of[cur][-1] == n
        chain, n = [], nds_of[cur][0 if rev else -1]
        while cur not in seen:
            seen.add(cur)
            fwd = nds_of[cur][0] == n
            chain.append((cur, fwd))
            n = nds_of[cur][-1 if fwd else 0]
            nxt = [w for w in ends[n] if w != cur] if n in cont else []
            if not nxt:
                break
            cur = nxt[0]
        chains.append(chain)
    lines, pins, parts = {}, {}, {}
    for ci, chain in enumerate(chains):
        p, pin, part = [], [], []
        for wid, fwd in chain:
            nds = nds_of[wid] if fwd else nds_of[wid][::-1]
            if not p:
                p.append(project(*nodes[nds[0]]))
                pin.append(True)
            start = len(p) - 1
            for na, nb in zip(nds, nds[1:]):
                a, b = project(*nodes[na]), project(*nodes[nb])
                k = max(1, math.ceil(math.dist(a, b) / 8))
                p += [(a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k) for j in range(1, k + 1)]
                pin += [False] * (k - 1) + [nb not in cont and (use[nb] > 1 or nb == nds[-1])]
            part.append((wid, fwd, start, len(p) - 1))
        pin[-1] = True
        lines[ci], pins[ci], parts[ci] = p, pin, part
    out = lines
    for _ in range(2):
        out = _align_pass(lines, out, pins)
    res = {}
    for ci, part in parts.items():
        for wid, fwd, i0, i1 in part:
            q, pin = out[ci][i0:i1 + 1], pins[ci][i0:i1 + 1]
            pin[0] = pin[-1] = True
            q = _smooth_track(q, pin)
            res[wid] = q if fwd else q[::-1]
    print(f"tram tracks aligned: {len(res)} ways in {len(chains)} chains")
    return res


def _align_pass(orig, lines, pins):
    """Пути двухпутной линии в OSM нарисованы независимо и местами сходятся/расходятся.
    Каждую точку пути (через ≤8 м) ставим на ±1.6 м от середины между ним и соседним
    параллельным путём (2–7 м), затем сглаживаем. Где соседа нет (развилки, одиночный
    путь, перекрёстки) — как в OSM. У закреплённых узлов (pins) — как в OSM, сдвиг
    нарастает на TRACK_BLEND. Возвращает {way id: [(x, z)]}."""
    cell = 20.0
    grid = {}
    arc = {}
    for wid, p in lines.items():
        o = orig[wid]
        arc[wid] = acc = [0.0]
        for i in range(1, len(o)):
            acc.append(acc[-1] + math.dist(o[i - 1], o[i]))
        for i in range(1, len(p)):
            a, b = p[i - 1], p[i]
            for gx in range(int(min(a[0], b[0]) // cell) - 1, int(max(a[0], b[0]) // cell) + 2):
                for gz in range(int(min(a[1], b[1]) // cell) - 1, int(max(a[1], b[1]) // cell) + 2):
                    grid.setdefault((gx, gz), []).append((wid, i, a, b))
    out = {}
    for wid, p in lines.items():
        o, pin = orig[wid], pins[wid]
        # Расстояние вдоль пути до ближайшего закреплённого узла — вес сдвига.
        acc = arc[wid]
        near = [math.inf] * len(o)
        last = -math.inf
        for i in range(len(o)):
            if pin[i]:
                last = acc[i]
            near[i] = acc[i] - last
        last = math.inf
        for i in range(len(o) - 1, -1, -1):
            if pin[i]:
                last = acc[i]
            near[i] = min(near[i], last - acc[i])
        q = []
        fixed = []
        for i, P in enumerate(p):
            a, b = p[max(0, i - 1)], p[min(len(p) - 1, i + 1)]
            L = math.dist(a, b) or 1
            dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            best = None
            for w2, j, c, d in grid.get((int(P[0] // cell), int(P[1] // cell)), ()):
                # Цепочка может обойти кольцо разворота и вернуться встречным путём — сосед из
                # той же цепочки годится, если он далеко по ней.
                if w2 == wid and abs(acc[j] - acc[i]) < 30:
                    continue
                ex, ez = d[0] - c[0], d[1] - c[1]
                l2 = ex * ex + ez * ez or 1
                if abs(ex * dx + ez * dz) / math.sqrt(l2) < 0.94:
                    continue
                t = max(0, min(1, ((P[0] - c[0]) * ex + (P[1] - c[1]) * ez) / l2))
                Q = (c[0] + ex * t, c[1] + ez * t)
                D = math.dist(P, Q)
                if 1.5 < D < 9 and (best is None or D < best[0]):
                    best = (D, Q)
            wgt = min(1.0, near[i] / TRACK_BLEND)
            if best and wgt > 0:
                Q = best[1]
                mx, mz = (P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2
                side = 1 if (P[0] - Q[0]) * -dz + (P[1] - Q[1]) * dx > 0 else -1
                A = (mx - dz * TRACK_HALF * side, mz + dx * TRACK_HALF * side)
                q.append((o[i][0] + (A[0] - o[i][0]) * wgt, o[i][1] + (A[1] - o[i][1]) * wgt))
                fixed.append(True)
            else:
                q.append(o[i])
                fixed.append(False)
        # Сглаживание (закреплённые узлы на месте).
        for _ in range(3):
            q = [q[i] if pin[i] or i in (0, len(q) - 1) or not (fixed[i - 1] or fixed[i] or fixed[i + 1]) else
                 ((q[i - 1][0] + 2 * q[i][0] + q[i + 1][0]) / 4, (q[i - 1][1] + 2 * q[i][1] + q[i + 1][1]) / 4)
                 for i in range(len(q))]
        out[wid] = q
    return out


def _smooth_track(p, pin):
    """Повороты путей в OSM — ломаные из редких точек. Между закреплёнными узлами срезаем углы
    (Chaikin, 3 раза: дуга вместо ломаной), потом убираем лишние точки на прямых (≤ 3 см)."""
    out = [p[0]]
    start = 0
    for i in range(1, len(p)):
        if not pin[i] and i < len(p) - 1:
            continue
        seg = p[start:i + 1]
        for _ in range(3):
            if len(seg) < 3:
                break
            nxt = [seg[0]]
            for a, b in zip(seg, seg[1:]):
                nxt += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]),
                        (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
            nxt[1], nxt[-1] = seg[0], seg[-1]  # концы куска на месте
            seg = [nxt[0]] + nxt[2:-1] + [seg[-1]]
        out += _simplify(seg, 0.03)[1:]
        start = i
    return [(round(x, 2), round(z, 2)) for x, z in out]


def _simplify(p, eps):
    """Дуглас — Пекер (без рекурсии: после сглаживания в куске тысячи точек)."""
    keep = [False] * len(p)
    keep[0] = keep[-1] = True
    stack = [(0, len(p) - 1)]
    while stack:
        i0, i1 = stack.pop()
        (ax, az), (bx, bz) = p[i0], p[i1]
        L = math.hypot(bx - ax, bz - az) or 1e-9
        best, bd = None, eps
        for i in range(i0 + 1, i1):
            d = abs((p[i][0] - ax) * (bz - az) - (p[i][1] - az) * (bx - ax)) / L
            if d > bd:
                best, bd = i, d
        if best is not None:
            keep[best] = True
            stack += [(i0, best), (best, i1)]
    return [q for q, k in zip(p, keep) if k]


def tram_routes(aligned):
    """Маршруты трамваев (route=tram): ломаная по путям в порядке участников отношения,
    остановки (роль stop*) — расстоянием вдоль ломаной."""
    out = []
    for rid, (members, tags) in relations.items():
        if tags.get("route") != "tram" or tags.get("type") != "route":
            continue
        chain, pts = [], []
        for t, ref, role in members:
            if t != "way" or ref not in ways or role not in ("", "forward", "backward"):
                continue
            nds = [n for n in ways[ref][0] if n in nodes]
            if len(nds) < 2:
                continue
            geo = list(aligned.get(ref) or [project(*nodes[n]) for n in nds])
            if chain:
                # Развернуть кусок, чтобы он продолжал предыдущий.
                if nds[-1] == chain[-1] or (nds[0] != chain[-1] and math.dist(project(*nodes[nds[-1]]), project(*nodes[chain[-1]]))
                                             < math.dist(project(*nodes[nds[0]]), project(*nodes[chain[-1]]))):
                    nds = nds[::-1]
                    geo = geo[::-1]
                if nds[0] == chain[-1]:
                    nds = nds[1:]
                    geo = geo[1:]
            chain += nds
            pts += geo
        if len(pts) < 2:
            continue
        acc = [0.0]
        for i in range(1, len(pts)):
            acc.append(acc[-1] + math.dist(pts[i - 1], pts[i]))
        stops = []
        for t, ref, role in members:
            if t == "node" and role.startswith("stop") and ref in nodes:
                p = project(*nodes[ref])
                best = min(range(len(pts)), key=lambda i: math.dist(pts[i], p))
                if math.dist(pts[best], p) < 40:
                    stops.append(round(acc[best], 1))
        out.append({"ref": tags.get("ref", ""), "name": tags.get("name", ""),
                    "p": [(round(x, 2), round(z, 2)) for x, z in pts], "stops": sorted(stops)})
    print(f"tram routes: {len(out)}")
    return out


# ---------------------------------------------------------------- остановки

def transport_stops(inside):
    """Автобусные и троллейбусные остановки: [x, z, навес (1 — есть, 0 — нет, 2 — не размечен)].
    Точки highway=bus_stop / platform у тротуара; повторы ближе 15 м — одна. Трамвайные пока не берём."""
    out = []
    for nid, t in node_tags.items():
        if t.get("train") == "yes" or t.get("highway") != "bus_stop" and (
                t.get("public_transport") != "platform" or t.get("tram") == "yes"):
            continue
        x, z = project(*nodes[nid])
        if not inside([(x, z)]) or any(math.dist((x, z), o[:2]) < 15 for o in out):
            continue
        out.append([round(x, 1), round(z, 1), {"yes": 1, "no": 0}.get(t.get("shelter"), 2)])
    print(f"stops: {len(out)}")
    return out


# ---------------------------------------------------------------- заборы

# Вид забора в браузере: bars — металлическая решётка, mesh — сетка-рабица, wood — доски,
# prof — профлист, panel — бетонные плиты, brick — кирпичная стена, hedge — живая изгородь,
# jersey — бетонные блоки у дороги.
FENCE_TYPE = {
    "metal": "bars", "bars": "bars", "railing": "bars", "railings": "bars", "metal_bars": "bars", "steel": "bars",
    "chain_link": "mesh", "wire": "mesh", "wire_mesh": "mesh", "mesh": "mesh", "chain": "mesh", "barbed_wire": "mesh",
    "wood": "wood", "split_rail": "wood", "pickets": "wood", "palisade": "wood", "wooden": "wood",
    "corrugated_metal": "prof", "metal_sheet": "prof",
    "concrete": "panel", "wall": "panel", "brick": "brick", "stone": "brick",
}
FENCE_H = {"bars": 1.6, "mesh": 1.8, "wood": 1.8, "prof": 2.0, "panel": 2.4, "brick": 2.0, "hedge": 1.3, "jersey": 0.8}
GATE_W = {"gate": 4.0, "lift_gate": 4.0, "swing_gate": 4.0, "sliding_gate": 5.0, "sally_port": 4.0,
          "wicket_gate": 1.2, "kissing_gate": 1.2, "entrance": 1.5, "turnstile": 1.0, "full-height_turnstile": 1.0}


def fence_kind(tags, ctx):
    """ctx — 'industrial' (промзона, гаражи), 'village' (частный сектор) или None."""
    b = tags["barrier"]
    if b == "hedge":
        return "hedge"
    if b == "jersey_barrier":
        return "jersey"
    k = FENCE_TYPE.get(tags.get("fence_type")) or FENCE_TYPE.get(tags.get("material"))
    if k:
        return k
    # Забор, нарисованный по контуру участка, сам говорит, что за ним.
    if tags.get("landuse") in ("industrial", "garages", "railway", "construction") or "man_made" in tags:
        ctx = "industrial"
    elif tags.get("landuse") in ("allotments", "farmyard") or tags.get("place"):
        ctx = "village"
    elif "amenity" in tags or "leisure" in tags:
        ctx = None
    if b == "wall":
        return "panel" if ctx == "industrial" else "brick"
    return {"industrial": "panel", "village": None}.get(ctx, "bars")


def fences(inside, roads, road_nodes, areas, buildings, footbridges):
    """Заборы, стены, изгороди: [{"k": вид, "h": высота, "p": точки}], уже с проёмами — ворота и
    калитки (точки barrier=gate… на линии), тропинки через забор, дороги поперёк и сам забор на полотне.
    Перила пешеходных мостов (в OSM — заборы по краю настила без bridge=*) и заборы с layer ≥ 1 не
    берём: на земле они встали бы поперёк улицы и путей под мостом."""
    # Индекс осей дорог (кроме мостов и тоннелей: под мостом забор остаётся).
    CELL = 50
    rgrid = {}
    for r in roads:
        if r["br"] or r["tu"]:
            continue
        for i in range(1, len(r["n"])):
            (ax, az), (bx, bz) = road_nodes[r["n"][i - 1]], road_nodes[r["n"][i]]
            s = (ax, az, bx, bz, r["w"])
            for gi in range(int(min(ax, bx) // CELL) - 1, int(max(ax, bx) // CELL) + 2):
                for gj in range(int(min(az, bz) // CELL) - 1, int(max(az, bz) // CELL) + 2):
                    rgrid.setdefault((gi, gj), []).append(s)
    near = lambda x, z: rgrid.get((int(x // CELL), int(z // CELL)), ())

    path_nodes = set()
    for nds, tags in ways.values():
        if tags.get("highway") in PATHS:
            path_nodes.update(nds)

    # Окружение: промзона (точка в участке industrial) или частный сектор (рядом частные дома).
    AC = 200
    agrid = {}
    for a in areas:
        if a["k"] != "industrial":
            continue
        xs, zs = [p[0] for p in a["p"]], [p[1] for p in a["p"]]
        for gi in range(int(min(xs) // AC), int(max(xs) // AC) + 1):
            for gj in range(int(min(zs) // AC), int(max(zs) // AC) + 1):
                agrid.setdefault((gi, gj), []).append((min(xs), min(zs), max(xs), max(zs), a["p"]))
    BC = 40
    bgrid = {}
    for b in buildings:
        cx = sum(p[0] for p in b["p"]) / len(b["p"])
        cz = sum(p[1] for p in b["p"]) / len(b["p"])
        bgrid.setdefault((int(cx // BC), int(cz // BC)), []).append(b.get("r") == 1)

    def context(x, z):
        for x0, z0, x1, z1, p in agrid.get((int(x // AC), int(z // AC)), ()):
            if x0 <= x <= x1 and z0 <= z <= z1 and point_in(x, z, p):
                return "industrial"
        houses = [v for i in (-1, 0, 1) for j in (-1, 0, 1) for v in bgrid.get((int(x // BC) + i, int(z // BC) + j), ())]
        return "village" if sum(houses) >= 3 and sum(houses) * 2 >= len(houses) else None

    def seg_dist(x, z, a, b):
        ex, ez = b[0] - a[0], b[1] - a[1]
        q = min(1, max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez or 1)))
        return math.hypot(x - a[0] - ex * q, z - a[1] - ez * q)

    def on_bridge(x, z):
        for fb in footbridges:
            p = fb["p"]
            if fb["a"] and point_in(x, z, p):
                return True
            edges = zip(p, p[1:] + p[:1]) if fb["a"] else zip(p, p[1:])
            if any(seg_dist(x, z, a, b) < (1.5 if fb["a"] else fb["w"] / 2 + 1.5) for a, b in edges):
                return True
        return False

    out, total = [], 0.0
    for wid, (nds, tags) in ways.items():
        if tags.get("barrier") not in ("fence", "wall", "hedge", "jersey_barrier", "city_wall"):
            continue
        if tags.get("bridge") not in (None, "no") or tags.get("tunnel") not in (None, "no"):
            continue
        if (parse_num(tags.get("layer")) or 0) >= 1:
            continue
        nds = [n for n in nds if n in nodes]
        if len(nds) < 2:
            continue
        pts = [project(*nodes[n]) for n in nds]
        if not inside(pts):
            continue
        acc = [0.0]
        for i in range(1, len(pts)):
            acc.append(acc[-1] + math.dist(pts[i - 1], pts[i]))
        L = acc[-1]
        if L < 1:
            continue
        gaps = []
        for i, n in enumerate(nds):
            t = node_tags.get(n, {})
            w = GATE_W.get(t.get("barrier"))
            if w:
                w = min(max(parse_num(t.get("width")) or w, 0.8), 12)
            elif n in path_nodes:
                w = 1.6
            if w:
                gaps.append((acc[i] - w / 2, acc[i] + w / 2))
        for i in range(1, len(pts)):
            (ax, az), (bx, bz) = pts[i - 1], pts[i]
            seg = acc[i] - acc[i - 1]
            if seg < 1e-6:
                continue
            ux, uz = (bx - ax) / seg, (bz - az) / seg
            cands = {s for k in range(int(seg // CELL) + 2)
                     for s in near(ax + ux * min(k * CELL, seg), az + uz * min(k * CELL, seg))}
            # Дорога поперёк: проём на ширину полотна с запасом, по косой — шире.
            for cx, cz, dx, dz, rw in cands:
                ex, ez = dx - cx, dz - cz
                den = ux * ez - uz * ex
                if abs(den) < 1e-9:
                    continue
                t = ((cx - ax) * ez - (cz - az) * ex) / den
                el = math.hypot(ex, ez)
                v = ((cx - ax) * uz - (cz - az) * ux) / den
                if 0 <= t <= seg and 0 <= v <= 1:
                    half = (rw / 2 + 0.8) / max(abs(den) / el, 0.35)
                    gaps.append((acc[i - 1] + t - half, acc[i - 1] + t + half))
            # Забор на самом полотне (широкая дорога, конец забора у бордюра) — убрать.
            s = 0.0
            while s <= seg:
                x, z = ax + ux * s, az + uz * s
                for cx, cz, dx, dz, rw in cands:
                    ex, ez = dx - cx, dz - cz
                    l2 = ex * ex + ez * ez or 1
                    q = min(1, max(0, ((x - cx) * ex + (z - cz) * ez) / l2))
                    if math.hypot(x - cx - ex * q, z - cz - ez * q) < rw / 2 + 0.2:
                        gaps.append((acc[i - 1] + s - 0.5, acc[i - 1] + s + 0.5))
                        break
                s += 1.0
        # Сплошные куски между проёмами.
        gaps.sort()
        solid, cur = [], 0.0
        for g0, g1 in gaps:
            if g0 > cur:
                solid.append((cur, g0))
            cur = max(cur, g1)
        if cur < L:
            solid.append((cur, L))
        mx, mz = pts[len(pts) // 2]
        kind = fence_kind(tags, context(mx, mz))
        if kind is None:  # частный сектор: доски или профлист, по забору
            kind = "wood" if wid % 3 else "prof"
        h = parse_num(tags.get("height"))
        h = round(min(max(h, 0.5), 4.0), 1) if h else FENCE_H[kind]

        def at(s):
            i = min(max(1, next((k for k in range(1, len(acc)) if acc[k] >= s), len(acc) - 1)), len(acc) - 1)
            f = (s - acc[i - 1]) / ((acc[i] - acc[i - 1]) or 1)
            return [round(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, 2), round(pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f, 2)]

        for s0, s1 in solid:
            if s1 - s0 < 1:
                continue
            p = [at(s0)] + [[round(x, 2), round(z, 2)] for (x, z), a in zip(pts, acc) if s0 < a < s1] + [at(s1)]
            if on_bridge(*at((s0 + s1) / 2)):
                continue
            out.append({"k": kind, "h": h, "p": p})
            total += s1 - s0
    print(f"fences: {len(out)} pieces, {total / 1000:.0f} km")
    return out


# ---------------------------------------------------------------- заправки-точки

def add_point_fuel_stations(fuel, areas, buildings, roads, road_nodes, inside):
    """АЗС, отмеченные в OSM только точкой: площадка 34×24 м вдоль ближайшей дороги
    и навес над колонками, если на месте нет домов."""
    n = 0
    for nid, tags in node_tags.items():
        if tags.get("amenity") != "fuel":
            continue
        x, z = project(*nodes[nid])
        if not inside([(x, z)]) or any(point_in(x, z, st["p"]) for st in fuel):
            continue
        best = None
        for r in roads:
            if r["k"] not in DRIVE:
                continue
            for i in range(1, len(r["n"])):
                a, b = road_nodes[r["n"][i - 1]], road_nodes[r["n"][i]]
                if abs(a[0] - x) > 200 and abs(b[0] - x) > 200:
                    continue
                dx, dz = b[0] - a[0], b[1] - a[1]
                l2 = dx * dx + dz * dz or 1
                t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2))
                d = math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)
                if best is None or d < best[0]:
                    best = (d, dx, dz)
        if not best or best[0] > 120:
            continue
        L = math.hypot(best[1], best[2])
        ux, uz = best[1] / L, best[2] / L

        def rect(cx, cz, hl, hw):
            return [(round(cx + ux * a - uz * b, 2), round(cz + uz * a + ux * b, 2)) for a, b in ((-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw))]

        # Рядом здание без этажности и назначения — это навес/магазин АЗС (часто так и размечено):
        # площадка вокруг него, а само здание станет низким навесом (ниже, «Здания на АЗС»).
        near = [b for b in buildings if b["_auto_h"] and b["_btag"] in ("yes", "roof", "service", "retail") and b["_area"] < 1500
                and (point_in(x, z, b["p"]) or min(math.dist((x, z), p) for p in b["p"]) < 25)]
        if near:
            xs = [p[0] for b in near for p in b["p"]]
            zs = [p[1] for b in near for p in b["p"]]
            m = 10
            site = [(min(xs) - m, min(zs) - m), (max(xs) + m, min(zs) - m), (max(xs) + m, max(zs) + m), (min(xs) - m, max(zs) + m)]
        else:
            site = rect(x, z, 17, 12)
            # На месте другие дома (точка в OSM неточная) — площадку не ставим.
            if any(point_in(*b["p"][0], site) or point_in(x, z, b["p"]) for b in buildings
                   if abs(b["p"][0][0] - x) < 60 and abs(b["p"][0][1] - z) < 60):
                continue
            buildings.append({"p": rect(x, z, 9, 5), "h": 5.3, "mh": 4.5, "s": 5, "_raised": True, "_auto_h": False,
                              "_btag": "roof", "_levels": None, "_area": 180.0, "_fuel": True})
        areas.append({"k": "paved", "p": site})
        fuel.append({"name": tags.get("brand") or osm_name(tags) or "АЗС", "p": site})
        n += 1
    print(f"point fuel stations: {n}")


# ---------------------------------------------------------------- мосты

WATERWAY_W = {"river": 12, "canal": 6, "stream": 3, "ditch": 1.5, "drain": 1.5}


def seg_cross(a, b, c, d):
    """Точка пересечения отрезков ab и cd или None."""
    r = (b[0] - a[0], b[1] - a[1])
    q = (d[0] - c[0], d[1] - c[1])
    den = r[0] * q[1] - r[1] * q[0]
    if abs(den) < 1e-9:
        return None
    t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (a[0] + r[0] * t, a[1] + r[1] * t)
    return None


def classify_bridges(roads, road_nodes, waterways, rails):
    """Что пересекает автомобильный мост: водоток (в браузере — овраг под мостом) или дорогу/рельсы
    (нижняя дорога уходит в выемку). cx: [[x, z, "w"|"o"]]."""
    cell = 100.0
    grid = {}

    def put(kind, ref, pts):
        for i in range(1, len(pts)):
            a, b = pts[i - 1], pts[i]
            for gx in range(int(min(a[0], b[0]) // cell), int(max(a[0], b[0]) // cell) + 1):
                for gz in range(int(min(a[1], b[1]) // cell), int(max(a[1], b[1]) // cell) + 1):
                    grid.setdefault((gx, gz), []).append((kind, ref, a, b))

    for w in waterways:
        put("w", w, w["p"])
    for r in rails:
        put("o", r, r["p"])
    for r in roads:
        if not r["br"] and not r["tu"] and r["k"] in DRIVE:
            put("o", r, [road_nodes[n] for n in r["n"]])
    nb = 0
    for r in roads:
        if not r["br"] or r["tu"]:
            continue
        pts = [road_nodes[n] for n in r["n"]]
        own = set(r["n"])
        found = []
        for i in range(1, len(pts)):
            a, b = pts[i - 1], pts[i]
            seen = set()
            for gx in range(int(min(a[0], b[0]) // cell), int(max(a[0], b[0]) // cell) + 1):
                for gz in range(int(min(a[1], b[1]) // cell), int(max(a[1], b[1]) // cell) + 1):
                    for kind, ref, c, d in grid.get((gx, gz), ()):
                        if ref is r or (id(ref), c, d) in seen:
                            continue
                        seen.add((id(ref), c, d))
                        # Примыкание к концам моста — не пересечение.
                        if kind == "o" and isinstance(ref, dict) and "n" in ref and set(ref["n"]) & own:
                            continue
                        p = seg_cross(a, b, c, d)
                        if p and min(math.dist(p, pts[0]), math.dist(p, pts[-1])) > 4:
                            found.append([round(p[0], 1), round(p[1], 1), kind])
        if found:
            r["cx"] = found
            nb += 1
    print(f"bridges over something: {nb} of {sum(1 for r in roads if r['br'])}")


# ---------------------------------------------------------------- частный сектор

# ---------------------------------------------------------------- ГИС ЖКХ

GIS = os.path.join(RAW, "gis_izhevsk.json")  # выжимка tools/gis_extract.py; нет файла — без неё
GIS_K = 0.76  # общая площадь дома / (площадь контура × этажи), подобрано по домам с этажностью в OSM
STREET_TYPES = re.compile(r"\b(ул|улица|пер|переулок|пр-кт|проспект|пр-д|проезд|пл|площадь|тракт|б-р|бульвар|ш|шоссе|им|имени|"
                          r"мкр|микрорайон|наб|набережная|тер|кв-л|квартал|туп|тупик|аллея|линия)\b\.?")


def addr_key(street, num):
    """Адрес для сравнения OSM с ГИС: улица без типа (слова по алфавиту), номер без «д.», корпус — «к»."""
    st = re.sub(r"[^\w]+", " ", STREET_TYPES.sub(" ", street.lower().replace("ё", "е")))
    n = re.sub(r"^д\.?", "", num.lower().replace(" ", ""))
    n = n.replace("корп.", "к").replace("корпус", "к").replace("стр.", "с").replace(",", "")
    return " ".join(sorted(st.split())), n


def gis_levels(est):
    """Этажность из площади: до 6 — как есть (±1 этаж), выше — разброс ±15%, тянем к типовым 9 и 10."""
    if est < 6.5:
        return max(1, round(est))
    if est < 10.5:
        return 9
    if est < 11.5:
        return 10
    return min(30, round(est))


IZHEVSK_REL = 954515  # граница городского округа: в тайлах по рамке карты она неполная — докачивается целиком


def izhevsk_rings():
    """Контуры городского округа Ижевск (локальные метры). Адреса ГИС — только ижевские, а в сёлах внутри
    карты свои «Ленина, 17»: без границы они получали этажность ижевских многоэтажек."""
    root = ET.fromstring(fetch(f"https://api.openstreetmap.org/api/0.6/relation/{IZHEVSK_REL}/full", f"rel_{IZHEVSK_REL}.xml"))
    nd = {int(e.get("id")): (float(e.get("lat")), float(e.get("lon"))) for e in root.iter("node")}
    wy = {int(e.get("id")): [int(n.get("ref")) for n in e.findall("nd")] for e in root.iter("way")}
    rel = next(e for e in root.iter("relation") if int(e.get("id")) == IZHEVSK_REL)
    outer = [wy[int(m.get("ref"))] for m in rel.findall("member")
             if m.get("type") == "way" and m.get("role") in ("outer", "") and int(m.get("ref")) in wy]
    return [[project(*nd[n]) for n in r] for r in stitch(outer)]


def apply_gis(buildings):
    """Сведения ГИС ЖКХ по адресу: многоквартирный дом без этажности в OSM получает этажность по площади
    (площадь контура — сумма всех зданий с этим адресом: корпуса одного дома); частный дом из ГИС —
    признак для mark_village_houses. Серия фасада пересчитывается под новую высоту."""
    if not os.path.exists(GIS):
        print("gis: нет data/raw/gis_izhevsk.json — без ГИС ЖКХ")
        return
    gis = {}
    for h in json.load(open(GIS, encoding="utf-8")):
        k = addr_key(h["s"], h["n"])
        if k not in gis or h["t"] == "mkd":
            gis[k] = h
    city, cells = izhevsk_rings(), {}

    def in_city(x, z):  # с точностью до клетки 50 м: граница по полям и лесу, дома на ней редки
        c = (int(x // 50), int(z // 50))
        if c not in cells:
            cells[c] = any(point_in(c[0] * 50 + 25, c[1] * 50 + 25, r) for r in city)
        return cells[c]

    by_addr = {}
    for b in buildings:
        t = b.get("_tags", {})
        # Храмы, промзона, навесы — не жильё, даже если адрес совпал (храм при частном доме и т. п.).
        if "addr:street" in t and "addr:housenumber" in t and not b.get("lm") and not b.get("pw") and b["s"] not in (3, 4, 5):
            h = gis.get(addr_key(t["addr:street"], t["addr:housenumber"]))
            if h and t.get("addr:city", "Ижевск") == "Ижевск" and in_city(*b["p"][0]):
                by_addr.setdefault(id(h), (h, []))[1].append(b)
    lv_set = houses = 0
    for h, bs in by_addr.values():
        if h["t"] != "mkd":
            for b in bs:
                b["_gis"] = "house"
            houses += len(bs)
            continue
        foot = sum(b["_area"] for b in bs)
        for b in bs:
            b["_gis"] = "mkd"
            restyle = lambda: building_style({**b["_tags"], "building": "apartments"}, b["_id"], b["h"], b["p"])
            if not b["_auto_h"] or h["a"] <= 0 or foot <= 30 or b.get("mh"):
                b["s"] = restyle()  # жилой по ГИС, даже если в OSM просто building=yes
                continue
            est = h["a"] / (foot * GIS_K)
            # Маленький контур и много этажей — адрес висит на пристройке (тамбур, подстанция), а сам
            # дом нарисован без адреса: площадь дома делится не на тот контур.
            if est > 5.5 and foot < 250:
                b["s"] = restyle()
                continue
            lv = gis_levels(est)
            b["h"] = round(lv * 3.1 + 1.0, 1)
            b["_levels"] = lv
            b["_auto_h"] = False
            b["s"] = restyle()
            lv_set += 1
    print(f"gis: matched {sum(len(bs) for _, bs in by_addr.values())} buildings, levels {lv_set}, private {houses}")


HOUSE_TAGS = {"house", "detached", "semidetached_house", "bungalow", "cabin", "farm", "terrace"}
SMALL = 220        # м²: «маленький дом»
NEIGHBORS = 8      # столько маленьких домов в радиусе — это посёлок/частный сектор
NEIGHBOR_R = 80


def obb_size(pts):
    """Ширина и длина прямоугольника наименьшей площади вокруг контура."""
    best = None
    for i in range(len(pts)):
        (x1, z1), (x2, z2) = pts[i - 1], pts[i]
        L = math.hypot(x2 - x1, z2 - z1)
        if L < 0.3:
            continue
        ux, uz = (x2 - x1) / L, (z2 - z1) / L
        ss = [x * ux + z * uz for x, z in pts]
        ts = [-x * uz + z * ux for x, z in pts]
        a, b = max(ss) - min(ss), max(ts) - min(ts)
        if best is None or a * b < best[0] * best[1]:
            best = (a, b)
    if not best:
        return 0.0, 0.0
    return min(best), max(best)


def mark_village_houses(buildings):
    """Частный дом — один этаж и двускатная крыша (r=1). Либо помечен как house/detached,
    либо небольшой дом без этажности среди множества таких же (посёлки, частный сектор)."""
    small = [b for b in buildings if b["_area"] < SMALL and not b.get("lm")]
    cell = NEIGHBOR_R
    grid = {}
    for b in small:
        b["_c"] = (sum(p[0] for p in b["p"]) / len(b["p"]), sum(p[1] for p in b["p"]) / len(b["p"]))
        grid.setdefault((int(b["_c"][0] // cell), int(b["_c"][1] // cell)), []).append(b)
    n = 0
    for b in small:
        if b.get("_fuel") or b["_btag"] in ("garage", "garages", "shed", "roof", "kiosk", "service", "industrial", "retail", "commercial"):
            continue
        if b.get("_gis") == "mkd":
            continue
        explicit = b["_btag"] in HOUSE_TAGS or b.get("_gis") == "house"
        # Форма дома: не гаражный бокс (крошечный) и не ряд гаражей/сараев (длинный и узкий).
        w, L = obb_size(b["p"])
        if not explicit and (b["_area"] < 35 or w < 5 or L > 2.6 * w):
            continue
        if not explicit:
            if not b["_auto_h"] or b["_btag"] not in ("yes", "residential", None):
                continue
            cx, cz = b["_c"]
            near = 0
            for i in range(int(cx // cell) - 1, int(cx // cell) + 2):
                for j in range(int(cz // cell) - 1, int(cz // cell) + 2):
                    near += sum(1 for q in grid.get((i, j), ()) if math.dist(q["_c"], b["_c"]) < NEIGHBOR_R)
            if near - 1 < NEIGHBORS:
                continue
        lv = b["_levels"] or 1
        b["h"] = round(lv * 2.9 + 0.3, 1)  # высота стен до карниза; крышу добавит браузер
        b["r"] = 1
        b["s"] = 6
        n += 1
    print(f"village houses: {n}")


GIBDD_CAMS = os.path.join(ROOT, "data", "gibdd_cams.json")


def gibdd_cams(inside):
    """Камеры скорости из перечня Госавтоинспекции (data/gibdd_cams.json, собирает tools/gibdd_cams.py):
    [x, z, 0, 1 — комплекс и на перекрёсток / 0] — предел берётся по улице (cameras.js). Комплексы только на
    перекрёсток, парковку, переезд — без скорости — не берём: проезд на красный штрафует signals.js."""
    with open(GIBDD_CAMS, encoding="utf-8") as f:
        rows = json.load(f)["cams"]
    out = []
    for c in rows:
        x, z = project(c["lat"], c["lon"])
        if "Скорость" in c["kinds"] and inside(x, z):
            out.append([x, z, 0, int("Перекресток" in c["kinds"])])
    return out


def build_city():
    xmin, zmax = project(SOUTH, WEST)
    xmax, zmin = project(NORTH, EAST)
    margin = 300

    def inside(pts):
        return any(xmin - margin < x < xmax + margin and zmin - margin < z < zmax + margin for x, z in pts)

    # Узлы дорог — общий массив, чтобы в браузере собрать граф.
    road_node_index = {}
    road_nodes = []

    def rn(nid):
        if nid not in road_node_index:
            road_node_index[nid] = len(road_nodes)
            road_nodes.append(project(*nodes[nid]))
        return road_node_index[nid]

    roads, paths, rails, buildings, areas, trees, footbridges, fuel, waterways = [], [], [], [], [], [], [], [], []

    for wid, (nds, tags) in ways.items():
        nds = [n for n in nds if n in nodes]
        if len(nds) < 2:
            continue
        hw = tags.get("highway")
        # Пешеходный мост: в браузере — настил с перилами над землёй/дорогой.
        if hw in PATHS | {"pedestrian"} and tags.get("bridge") not in (None, "no"):
            closed = nds[0] == nds[-1] and (tags.get("area") == "yes" or hw == "pedestrian")
            pts = ring_xy(nds) if closed else [project(*nodes[n]) for n in nds]
            length = sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))
            if inside(pts) and length >= 4:
                footbridges.append({"p": pts, "a": 1 if closed else 0, "w": FOOTBRIDGE_W.get(hw, 3.0),
                                    **FOOTBRIDGE_STYLE.get(wid, {})})
            continue
        if hw and tags.get("area") != "yes":
            if hw in PATHS:
                pts = ring_xy(nds) if nds[0] != nds[-1] else [project(*nodes[n]) for n in nds]
                if inside(pts):
                    paths.append(pts)
                continue
            if hw in ("construction", "proposed", "platform", "bus_stop", "raceway", "elevator"):
                continue
            pts = [project(*nodes[n]) for n in nds]
            if not inside(pts):
                continue
            roads.append({
                "n": [rn(n) for n in nds],
                "w": road_width(tags),
                "k": hw,
                "name": osm_name(tags),
                "br": 1 if tags.get("bridge") not in (None, "no") else 0,
                "tu": 1 if is_tunnel(tags, pts) else 0,
                # Полосы из OSM (если размечены): всего, вперёд, назад — для трафика.
                **({"ln": int(parse_num(tags["lanes"]))} if parse_num(tags.get("lanes")) else {}),
                **({"lf": int(parse_num(tags["lanes:forward"]))} if parse_num(tags.get("lanes:forward")) else {}),
                **({"lb": int(parse_num(tags["lanes:backward"]))} if parse_num(tags.get("lanes:backward")) else {}),
                "ow": 1 if tags.get("oneway") == "yes" else 0,
                **({"ms": ms} if (ms := maxspeed_kmh(tags)) else {}),
            })
            continue
        if tags.get("waterway") in WATERWAY_W and tags.get("tunnel") in (None, "no"):
            pts = [project(*nodes[n]) for n in nds]
            if inside(pts):
                waterways.append({"p": pts, "k": tags["waterway"], "w": WATERWAY_W[tags["waterway"]]})
            continue
        if tags.get("railway") in ("rail", "tram", "light_rail") and tags.get("tunnel") is None:
            pts = [project(*nodes[n]) for n in nds]
            if inside(pts):
                rails.append({"p": pts, "k": tags["railway"], "_w": wid})
            continue
        if nds[0] != nds[-1]:
            continue
        if "building" in tags and tags.get("building") != "no":
            lm = LANDMARK_BY_ELEMENT.get(("way", wid))
            if lm and LANDMARKS[lm][3] == "replace":
                continue
            pts = ring_xy(nds)
            if len(pts) < 3 or not inside(pts) or poly_area(pts) < 6:
                continue
            buildings.append(building_entry(pts, tags, wid, lm))
            continue
        kind = area_kind(tags)
        if kind:
            pts = ring_xy(nds)
            if len(pts) >= 3 and inside(pts):
                areas.append({"k": kind, "p": pts, **({"f": 1} if is_forest(tags) else {})})
                if tags.get("amenity") == "fuel":
                    fuel.append({"name": tags.get("brand") or osm_name(tags) or "АЗС", "p": pts})

    for rid, (members, tags) in relations.items():
        if tags.get("type") != "multipolygon":
            continue
        outer = [ways[ref][0] for t, ref, role in members if t == "way" and ref in ways and role in ("outer", "")]
        inner = [ways[ref][0] for t, ref, role in members if t == "way" and ref in ways and role == "inner"]
        is_building = "building" in tags
        kind = area_kind(tags)
        if not is_building and not kind:
            continue
        holes = [ring_xy(r) for r in stitch(inner)]
        for ring in stitch(outer):
            pts = ring_xy(ring)
            if len(pts) < 3 or not inside(pts):
                continue
            if is_building:
                lm = LANDMARK_BY_ELEMENT.get(("relation", rid))
                if lm and LANDMARKS[lm][3] == "replace":
                    continue
                # Дворы и поле стадиона внутри здания-кольца (трибуны) — дыры, а не сплошная коробка.
                own = [h for h in holes if len(h) >= 3 and point_in(*h[0], pts)]
                buildings.append(building_entry(pts, tags, rid, lm, own))
            else:
                areas.append({"k": kind, "p": pts, **({"holes": holes} if holes else {}), **({"f": 1} if is_forest(tags) else {})})

    for nid, tags in node_tags.items():
        if tags.get("natural") == "tree":
            x, z = project(*nodes[nid])
            if xmin < x < xmax and zmin < z < zmax:
                trees.append([x, z])

    add_point_fuel_stations(fuel, areas, buildings, roads, road_nodes, inside)
    # Здания на АЗС без этажности — магазин и навес в один этаж, а не выдуманные 6 этажей.
    # Навес над проездом поднимается целиком (тонкой плитой), а не режется аркой.
    for b in buildings:
        if any(point_in(*b["p"][0], st["p"]) for st in fuel):
            b["_fuel"] = True
            b["_raised"] = True
            if b["_auto_h"]:
                b["h"] = 4.1
    classify_bridges(roads, road_nodes, waterways, rails)
    apply_gis(buildings)
    mark_village_houses(buildings)
    fence_list = fences(inside, roads, road_nodes, areas, buildings, footbridges)
    buildings = cut_passages(buildings, roads, road_nodes)
    aligned = align_tram_tracks()
    for r in rails:
        w = r.pop("_w", None)
        if w in aligned:
            r["p"] = aligned[w]
    # Навесы над колонками: здания-крыши (mh — высота низа) внутри территории АЗС.
    for st in fuel:
        roofs = [b for b in buildings if b.get("mh") and point_in(*b["p"][0], st["p"])]
        for b in roofs:
            b["s"] = 5  # навес — глухой бетон, без окон
        st["roofs"] = [b["p"] for b in roofs]
    # Дорожка по мосту-площади — часть этой площади, отдельным настилом не нужна (было бы мерцание).
    decks = [fb["p"] for fb in footbridges if fb["a"]]
    footbridges = [fb for fb in footbridges if fb["a"] or not any(
        point_in(*fb["p"][len(fb["p"]) // 2], d) or point_in(*fb["p"][0], d) and point_in(*fb["p"][-1], d) for d in decks)]

    # Большие площади (пруд) рисуем первыми, мелкие поверх.
    areas.sort(key=lambda a: -poly_area(a["p"]))
    return {
        "bounds": [xmin, zmin, xmax, zmax],
        "roadNodes": road_nodes,
        "roads": roads,
        "paths": paths,
        "rails": rails,
        "buildings": buildings,
        "areas": areas,
        "trees": trees,
        "footbridges": footbridges,
        "waterways": waterways,
        "fuel": fuel,
        "trams": tram_routes(aligned),
        "stops": transport_stops(inside),
        "fences": fence_list,
        "landmarks": landmark_entries(),
        # Светофоры — узлы дорог (индексы в roadNodes); в браузере группируются в перекрёстки.
        "signals": sorted(road_node_index[n] for n, t in node_tags.items()
                          if t.get("highway") == "traffic_signals" and n in road_node_index),
        # Камеры скорости — из перечня Госавтоинспекции (gibdd_cams), OSM их знает мало.
        "cams": gibdd_cams(lambda x, z: inside([(x, z)])),
    }


# ---------------------------------------------------------------- рельеф

TERRAIN_Z = 13  # тайлы высот Terrarium: z13 ≈ 10 м на пиксель на широте Ижевска


def terrarium_tile(x, y):
    """Тайл высот Terrarium (AWS Terrain Tiles): PNG, высота = R*256 + G + B/256 - 32768."""
    from PIL import Image
    import io
    body = fetch(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{TERRAIN_Z}/{x}/{y}.png",
                 f"terrarium_{TERRAIN_Z}_{x}_{y}.png", pause=0.2)
    return Image.open(io.BytesIO(body)).convert("RGB").load()


def download_dem(bounds):
    """Сетка высот с шагом DEM_STEP по тайлам Terrarium (билинейно между пикселями)."""
    xmin, zmin, xmax, zmax = bounds
    nx = int((xmax - xmin) / DEM_STEP) + 1
    nz = int((zmax - zmin) / DEM_STEP) + 1
    n = 2 ** TERRAIN_Z
    tiles = {}

    def px_height(gx, gy):
        tx, ty = int(gx // 256), int(gy // 256)
        if (tx, ty) not in tiles:
            print(f"DEM tile {tx},{ty}")
            tiles[(tx, ty)] = terrarium_tile(tx, ty)
        r, g, b = tiles[(tx, ty)][int(gx) % 256, int(gy) % 256]
        return r * 256 + g + b / 256 - 32768

    heights = []
    for j in range(nz):
        for i in range(nx):
            lat, lon = unproject(xmin + i * DEM_STEP, zmin + j * DEM_STEP)
            gx = (lon + 180) / 360 * n * 256 - 0.5
            gy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * 256 - 0.5
            fx, fy = math.floor(gx), math.floor(gy)
            u, v = gx - fx, gy - fy
            h = (px_height(fx, fy) * (1 - u) * (1 - v) + px_height(fx + 1, fy) * u * (1 - v)
                 + px_height(fx, fy + 1) * (1 - u) * v + px_height(fx + 1, fy + 1) * u * v)
            heights.append(round(h, 1))
    return {"x0": xmin, "z0": zmin, "step": DEM_STEP, "nx": nx, "nz": nz, "h": heights}


def main():
    os.makedirs(RAW, exist_ok=True)
    download_osm()
    print(f"parsed: {len(nodes)} nodes, {len(ways)} ways, {len(relations)} relations")
    city = build_city()
    city["dem"] = download_dem(city["bounds"])
    city["origin"] = [LAT0, LON0]
    city["attribution"] = ("© OpenStreetMap contributors (ODbL); рельеф: Terrain Tiles (Mapzen / AWS, SRTM); "
                         "этажность и тип жилых домов: ГИС ЖКХ")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(city, f, ensure_ascii=False, separators=(",", ":"))
    print(f"roads {len(city['roads'])}, buildings {len(city['buildings'])}, areas {len(city['areas'])}, "
          f"trees {len(city['trees'])} -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
