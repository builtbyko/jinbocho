"""Build a quiet, local street base from OpenStreetMap road geometry.

The widths are cartographic estimates when OSM has no width tag. Sidewalks are
drawn only for ways explicitly tagged ``footway=sidewalk``. This is a visual
street guide, not a surveyed curb or property-boundary map.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, mapping, shape
from shapely.ops import linemerge, transform, unary_union


ROOT = Path(__file__).resolve().parents[1]
BOUNDARY = ROOT / "data/source/jinbocho-towns.geojson"
RAW = ROOT / "data/raw/osm-basemap.xml.gz"
RAW_META = ROOT / "data/raw/osm-basemap-meta.json"
OUTPUT = ROOT / "public/data"
OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
TO_METERS = Transformer.from_crs("EPSG:4326", "EPSG:6677", always_xy=True).transform
TO_WGS84 = Transformer.from_crs("EPSG:6677", "EPSG:4326", always_xy=True).transform

ROAD_WIDTHS = {
    "primary": 12.0,
    "secondary": 10.0,
    "tertiary": 8.0,
    "unclassified": 6.0,
    "residential": 5.5,
    "living_street": 4.5,
    "service": 3.5,
    "pedestrian": 4.5,
}
LABEL_NAMES = {
    "靖国通り",
    "白山通り",
    "すずらん通り",
    "専大通り",
    "明大通り",
    "神田警察通り",
}


def feature(geometry, properties: dict) -> dict:
    return {"type": "Feature", "properties": properties, "geometry": mapping(geometry)}


def write_geojson(name: str, features: list[dict], observed_at: str, note: str) -> None:
    collection = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {"source": OSM_ATTRIBUTION, "observedAt": observed_at, "note": note},
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / name).write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def load_or_fetch(scope, fetch: bool) -> bytes:
    if not fetch and RAW.exists():
        with gzip.open(RAW, "rb") as stream:
            return stream.read()
    if not fetch:
        raise SystemExit("OSM road snapshot is missing. Run with --fetch to retrieve it.")
    west, south, east, north = scope.bounds
    margin = 0.001
    bbox = f"{west - margin:.6f},{south - margin:.6f},{east + margin:.6f},{north + margin:.6f}"
    request = urllib.request.Request(
        f"https://api.openstreetmap.org/api/0.6/map?bbox={bbox}",
        headers={"User-Agent": "jinbocho-street-atlas/0.1 (https://github.com/builtbyko/jinbocho)"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        xml = response.read()
    RAW.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(RAW, "wb", compresslevel=9) as stream:
        stream.write(xml)
    RAW_META.write_text(
        json.dumps({"observedAt": datetime.now(timezone.utc).date().isoformat()}) + "\n",
        encoding="utf-8",
    )
    return xml


def parse_width(tags: dict[str, str], highway: str) -> float:
    explicit = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(?:m)?\s*$", tags.get("width", ""))
    if explicit:
        width = float(explicit.group(1))
        if 1.5 <= width <= 35:
            return width
    lanes = tags.get("lanes", "")
    if lanes.isdigit() and highway not in {"pedestrian", "living_street", "service"}:
        return min(ROAD_WIDTHS[highway] * 1.5, max(ROAD_WIDTHS[highway], int(lanes) * 3.1 + 1.5))
    return ROAD_WIDTHS[highway]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch", action="store_true", help="refresh the cached OSM map extract")
    args = parser.parse_args()

    boundary = json.loads(BOUNDARY.read_text(encoding="utf-8"))
    scope = unary_union([shape(item["geometry"]) for item in boundary["features"]])
    scope_m = transform(TO_METERS, scope)
    # Keep a narrow strip for streets that run along a town edge.
    clip_m = scope_m.buffer(8)
    root = ET.fromstring(load_or_fetch(scope, args.fetch))
    nodes = {
        node.attrib["id"]: (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for node in root.findall("node")
    }
    road_shapes = []
    sidewalk_shapes = []
    label_lines: dict[str, list] = defaultdict(list)
    road_count = sidewalk_count = 0

    for way in root.findall("way"):
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
        highway = tags.get("highway")
        if highway not in ROAD_WIDTHS and not (highway == "footway" and tags.get("footway") == "sidewalk"):
            continue
        if tags.get("tunnel") == "yes" or tags.get("access") in {"private", "no"}:
            continue
        coords = [nodes[nd.attrib["ref"]] for nd in way.findall("nd") if nd.attrib["ref"] in nodes]
        if len(coords) < 2:
            continue
        line = transform(TO_METERS, LineString(coords))
        if line.is_empty or not line.intersects(clip_m):
            continue

        if highway == "footway":
            sidewalk_count += 1
            sidewalk_shapes.append(line.buffer(1.2, cap_style=2, join_style=2))
            continue

        road_count += 1
        road_shapes.append(line.buffer(parse_width(tags, highway) / 2, cap_style=1, join_style=1))
        name = tags.get("name", "")
        if name in LABEL_NAMES:
            label_lines[name].append(line)

    if not road_shapes:
        raise SystemExit("No roads found in the OSM extract")
    roads = transform(TO_WGS84, unary_union(road_shapes).intersection(clip_m).simplify(0.12))
    sidewalks = transform(TO_WGS84, unary_union(sidewalk_shapes).intersection(clip_m).simplify(0.12))
    observed_at = json.loads(RAW_META.read_text(encoding="utf-8"))["observedAt"]
    write_geojson(
        "basemap-roads.geojson",
        [feature(roads, {"kind": "road"})],
        observed_at,
        "Road surfaces are inferred from OSM centerlines; widths without OSM tags are graphic estimates.",
    )
    write_geojson(
        "basemap-sidewalks.geojson",
        [feature(sidewalks, {"kind": "mapped_sidewalk"})] if sidewalk_shapes else [],
        observed_at,
        "Only OSM ways explicitly tagged footway=sidewalk are shown; edges are schematic.",
    )

    labels = []
    for name, parts in sorted(label_lines.items()):
        merged = linemerge(unary_union(parts))
        clipped = merged.intersection(clip_m)
        segments = [
            part for part in (clipped.geoms if hasattr(clipped, "geoms") else [clipped])
            if part.geom_type == "LineString" and part.length >= 60
        ]
        if segments:
            labels.append(feature(transform(TO_WGS84, max(segments, key=lambda part: part.length)), {"name": name}))
    write_geojson("basemap-road-names.geojson", labels, observed_at, "Street names from OSM highway tags.")
    print(f"Built {road_count} road ways, {sidewalk_count} mapped sidewalks, {len(labels)} named streets")


if __name__ == "__main__":
    main()
