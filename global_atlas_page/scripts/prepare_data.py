#!/usr/bin/env python3
"""Validate CSV/XLSX pins and create optimized, static GeoJSON for GitHub Pages.

Usage:
    python scripts/prepare_data.py data/pins.csv
    python scripts/prepare_data.py data/pins.xlsx   # requires: pip install openpyxl
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "public" / "data" / "pins.geojson"
REQUIRED = {"id", "title", "latitude", "longitude", "date", "category"}
OPTIONAL = {"location", "description", "url"}


def read_rows(path: Path):
    if path.suffix.lower() == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            headers = set(reader.fieldnames or [])
            yield headers, list(reader)
    elif path.suffix.lower() == ".xlsx":
        try:
            from openpyxl import load_workbook
        except ImportError as exc:
            raise SystemExit("Excel input requires: python -m pip install openpyxl") from exc
        workbook = load_workbook(path, read_only=True, data_only=True)
        sheet = workbook.active
        iterator = sheet.iter_rows(values_only=True)
        head = next(iterator, [])
        headers = [str(cell).strip() if cell is not None else "" for cell in head]
        rows = [dict(zip(headers, values)) for values in iterator]
        yield set(headers), rows
        workbook.close()
    else:
        raise SystemExit("Use a .csv or .xlsx file")


def strval(value):
    return "" if value is None else str(value).strip()


def make_geojson(path: Path):
    features = []
    seen = set()
    for headers, rows in read_rows(path):
        missing = REQUIRED - headers
        if missing:
            raise ValueError(f"Missing columns: {', '.join(sorted(missing))}")
        for line, row in enumerate(rows, start=2):
            if all(not strval(value) for value in row.values()):
                continue
            try:
                key = strval(row.get("id"))
                title = strval(row.get("title"))
                category = " / ".join(bit.strip() for bit in strval(row.get("category")).split("/") if bit.strip())
                if not key or not title or not category:
                    raise ValueError("id, title and category must be non-empty")
                if key in seen:
                    raise ValueError(f"duplicate id: {key}")
                seen.add(key)
                lat, lon = float(row["latitude"]), float(row["longitude"])
                if not -90 <= lat <= 90 or not -180 <= lon <= 180:
                    raise ValueError("latitude/longitude out of range")
                raw_date = row.get("date")
                day = raw_date.date() if isinstance(raw_date, datetime) else raw_date if isinstance(raw_date, date) else date.fromisoformat(strval(raw_date))
                url = strval(row.get("url"))
                if url and urlsplit(url).scheme not in ("http", "https"):
                    raise ValueError("url must be blank or start with https:// or http://")
                properties = {
                    "id": key,
                    "title": title,
                    "category": category,
                    "root": category.split(" / ")[0],
                    "date": day.isoformat(),
                    "day": (day - date(1970, 1, 1)).days,
                    "location": strval(row.get("location")),
                    "description": strval(row.get("description")),
                    "url": url,
                }
                features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}, "properties": properties})
            except (ValueError, TypeError, KeyError) as exc:
                raise ValueError(f"Invalid row {line}: {exc}") from exc
    if not features:
        raise ValueError("No valid data rows found")
    return {"type": "FeatureCollection", "features": features}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", default="data/pins.csv")
    args = parser.parse_args()
    path = Path(args.input)
    if not path.is_absolute():
        path = ROOT / path
    output = make_geojson(path)
    DEST.parent.mkdir(parents=True, exist_ok=True)
    with DEST.open("w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, separators=(",", ":"))
    print(f"Generated {DEST.relative_to(ROOT)} with {len(output['features']):,} pins from {path.name}")


if __name__ == "__main__":
    main()
