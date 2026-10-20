#!/usr/bin/env python3
"""Камеры скорости из перечня Госавтоинспекции Удмуртии -> data/gibdd_cams.json и cams в city.json.

Перечень — «Комплексы для сайта Госавтоинспекции» (.xls: адрес, широта, долгота, режим, виды нарушений).
В data/gibdd_cams.json кладутся все комплексы республики как есть; fetch_city.py берёт из него
комплексы, которые ловят скорость, внутри области города.

Запуск (нужен xlrd: pip install xlrd):
  python3 tools/gibdd_cams.py путь/к/перечню.xls   — обновить data/gibdd_cams.json и cams в public/city.json
                                                    без пересборки города
  python3 tools/gibdd_cams.py                      — только cams в public/city.json из data/gibdd_cams.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_city import OUT, ROOT, gibdd_cams  # noqa: E402

DATA = os.path.join(ROOT, "data", "gibdd_cams.json")


def read_xls(path):
    import xlrd
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    out = []
    for r in range(sheet.nrows):
        n, addr, lat, lon, mode, kinds = (sheet.row_values(r) + [""] * 6)[:6]
        try:  # координаты в перечне бывают и числом, и текстом
            lat, lon = float(str(lat).replace(",", ".")), float(str(lon).replace(",", "."))
        except ValueError:
            continue  # шапка
        out.append({"n": int(n), "addr": " ".join(addr.split()), "lat": lat, "lon": lon,
                    "mode": " ".join(mode.split()), "kinds": [k.strip() for k in kinds.split(",") if k.strip()]})
    return out


def main():
    if len(sys.argv) > 1:
        rows = read_xls(sys.argv[1])
        with open(DATA, "w", encoding="utf-8") as f:
            json.dump({"source": os.path.basename(sys.argv[1]), "cams": rows}, f, ensure_ascii=False, indent=1)
        print(f"{len(rows)} комплексов -> {DATA}")
    with open(OUT, encoding="utf-8") as f:
        city = json.load(f)
    xmin, zmin, xmax, zmax = city["bounds"]
    city["cams"] = gibdd_cams(lambda x, z: xmin - 300 < x < xmax + 300 and zmin - 300 < z < zmax + 300)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(city, f, ensure_ascii=False, separators=(",", ":"))
    print(f"камер скорости в городе: {len(city['cams'])} -> {OUT}")


if __name__ == "__main__":
    main()
