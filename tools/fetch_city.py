#!/usr/bin/env python3
"""Скачивает OSM и рельеф для центра Ижевска и собирает public/city.json.

Источники:
  - OSM: основной API (api/0.6/map), тайлами — Overpass часто лежит.
  - Рельеф: тайлы высот Terrarium (AWS Terrain Tiles, источник — SRTM и др.).
Сырые ответы кешируются в data/raw/, повторный запуск ничего не качает.

Запуск: python3 tools/fetch_city.py
"""
import json
import math
import os
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


# Достопримечательности: в браузере у них своя модель (replace), своя окраска
# и надстройка поверх обычной коробки (recolor) или отдельный объект рядом (add).
LANDMARKS = {
    "mikhailovsky": ("way", 28988606, "Свято-Михайловский собор", "replace"),
    "nevsky": ("way", 151492280, "Александро-Невский собор", "replace"),
    "troitsky": ("way", 453556944, "Свято-Троицкий собор", "replace"),
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


def building_style(tags, wid):
    """0 — панель, 1 — кирпич, 2 — штукатурка (охра), 3 — бетон/пром, 4 — храм, 5 — глухой бетон (трибуны, навесы),
    6 — частный дом (ставит mark_village_houses)."""
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
    if mat == "brick":
        return 1
    if mat in ("panel", "concrete"):
        return 0
    if b in ("apartments", "residential", "dormitory"):
        return wid % 2  # без данных — панель или кирпич
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
        "p": pts, "h": h, "s": building_style(tags, eid),
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
        explicit = b["_btag"] in HOUSE_TAGS
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
                "ow": 1 if tags.get("oneway") == "yes" else 0,
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
                rails.append({"p": pts, "k": tags["railway"]})
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
                areas.append({"k": kind, "p": pts})
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
                areas.append({"k": kind, "p": pts, **({"holes": holes} if holes else {})})

    for nid, tags in node_tags.items():
        if tags.get("natural") == "tree":
            x, z = project(*nodes[nid])
            if xmin < x < xmax and zmin < z < zmax:
                trees.append([x, z])

    # Здания на АЗС без этажности — магазин и навес в один этаж, а не выдуманные 6 этажей.
    # Навес над проездом поднимается целиком (тонкой плитой), а не режется аркой.
    for b in buildings:
        if any(point_in(*b["p"][0], st["p"]) for st in fuel):
            b["_fuel"] = True
            b["_raised"] = True
            if b["_auto_h"]:
                b["h"] = 4.1
    classify_bridges(roads, road_nodes, waterways, rails)
    mark_village_houses(buildings)
    buildings = cut_passages(buildings, roads, road_nodes)
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
        "landmarks": landmark_entries(),
        # Светофоры — узлы дорог (индексы в roadNodes); в браузере группируются в перекрёстки.
        "signals": sorted(road_node_index[n] for n, t in node_tags.items()
                          if t.get("highway") == "traffic_signals" and n in road_node_index),
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
    city["attribution"] = "© OpenStreetMap contributors (ODbL); рельеф: Terrain Tiles (Mapzen / AWS, SRTM)"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(city, f, ensure_ascii=False, separators=(",", ":"))
    print(f"roads {len(city['roads'])}, buildings {len(city['buildings'])}, areas {len(city['areas'])}, "
          f"trees {len(city['trees'])} -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
