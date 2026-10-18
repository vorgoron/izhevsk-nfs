#!/usr/bin/env python3
"""Выжимка по Ижевску из выгрузки ГИС ЖКХ «Сведения об объектах жилищного фонда» (CSV через «|»,
по Удмуртии — несколько файлов) → data/raw/gis_izhevsk.json. Её читает fetch_city.py: тип дома
(многоквартирный / частный) и этажность многоквартирных домов по площади.

Запуск: python3 tools/gis_extract.py "…/Сведения по ОЖФ Удмуртская Респ на 11-10-2026_1.csv" "…_2.csv"
"""
import csv
import json
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw", "gis_izhevsk.json")
TYPES = {"Многоквартирный": "mkd", "Жилой": "house", "Жилой дом блокированной застройки": "block"}


def main(paths):
    csv.field_size_limit(10 ** 8)
    houses = {}
    for path in paths:
        with open(path, encoding="utf-8", newline="") as f:
            rows = csv.reader(f, delimiter="|")
            ix = {k: i for i, k in enumerate(next(rows))}
            for row in rows:
                if len(row) < len(ix):
                    continue
                addr = row[ix["Адрес ОЖФ"]]
                if "г. Ижевск," not in addr:
                    continue
                key = row[ix["Глобальный уникальный идентификатор дома по ФИАС"]] or addr
                h = houses.setdefault(key, {"addr": addr, "t": None, "a": 0.0, "f": 0, "st": "", "gone": False})
                # Строки помещений: считаем квартиры (жилые помещения без комнат).
                if row[ix["Номер помещения (блока)"]] or row[ix["Номер комнаты"]]:
                    if not row[ix["Номер комнаты"]] and row[ix["Тип помещения (блока)"]] in ("Жилое", ""):
                        h["f"] += 1
                    continue
                h["t"] = TYPES.get(row[ix["Тип дома"]])
                h["st"] = row[ix["Состояние"]]
                h["gone"] = bool(row[ix["Дата сноса объекта"]])
                try:
                    h["a"] = float(row[ix["Общая площадь дома"]] or 0)
                except ValueError:
                    pass
    out = []
    for h in houses.values():
        parts = [p.strip() for p in h["addr"].split(",")]
        i = next((k for k, p in enumerate(parts) if p == "г. Ижевск"), None)
        if i is None or len(parts) < i + 3 or not h["t"] or h["gone"]:
            continue
        # После города: улица, номер дома (и корпус/строение — отдельными частями).
        out.append({"s": parts[i + 1], "n": " ".join(parts[i + 2:]), "t": h["t"], "a": round(h["a"], 1), "f": h["f"],
                    **({"st": h["st"]} if h["st"] in ("Аварийный", "Ветхий") else {})})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"houses: {len(out)} -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1:])
