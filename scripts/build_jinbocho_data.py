"""Build the public GeoJSON used by JINBOCHO STREET ATLAS.

The pipeline deliberately separates physical buildings from tenant/place records.
It uses a local official Tokyo building-current shapefile when available and OSM
for place/alley reference data. Curated facts override OSM candidates field by
field and retain their own source URL.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_PATH = ROOT / "data" / "source" / "jinbocho-towns.geojson"
CURATED_PATH = ROOT / "data" / "curated" / "places.json"
RAW_DIR = ROOT / "data" / "raw"
OSM_PATH = RAW_DIR / "osm-jinbocho.json"
GEOCODE_PATH = RAW_DIR / "geocodes.json"
PUBLIC_DIR = ROOT / "public" / "data"
DEFAULT_BUILDING_SOURCE = RAW_DIR / "tokyo-land-use-2021" / "R03建物現況.shp"
OBSERVED_DATE = "2026-09-22"
OSM_COPYRIGHT = "© OpenStreetMap contributors (ODbL)"
TOKYO_BUILDING_SOURCE = "東京都 令和3年度区部土地利用現況調査・建物現況"


def compact_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_name(value: str) -> str:
    value = value.casefold().replace("髙", "高").replace("﨑", "崎")
    return re.sub(r"[\s\u3000・･\-‐‑–—―ー()（）'\"/／]", "", value)


def era_for_year(year: int | None) -> str:
    if not year:
        return "unknown"
    if year <= 1944:
        return "prewar"
    if year <= 1969:
        return "1945-1969"
    if year <= 1999:
        return "1970-1999"
    return "2000-present"


def floor_position(value: Any) -> str:
    """Classify a place as ground, non-ground, or unknown.

    OSM indoor levels use 0 for the ground floor, while Japanese store
    addresses normally call the ground floor 1階.
    """
    if value is None:
        return "unknown"
    text = str(value).strip()
    if not text:
        return "unknown"

    without_basements = re.sub(r"地下\s*\d+\s*階", "", text)
    japanese_levels = [int(level) for level in re.findall(r"(\d+)\s*階", without_basements)]
    if japanese_levels:
        return "ground" if 1 in japanese_levels else "non_ground"
    if re.search(r"地下\s*\d+\s*階", text):
        return "non_ground"

    upper = text.upper()
    without_basements = re.sub(r"B\s*\d+\s*F", "", upper)
    floor_levels = [int(level) for level in re.findall(r"(\d+)\s*F", without_basements)]
    if floor_levels:
        return "ground" if 1 in floor_levels else "non_ground"
    if re.search(r"B\s*\d+\s*F", upper):
        return "non_ground"

    if re.fullmatch(r"[+-]?\d+(?:\s*[,;]\s*[+-]?\d+)*", text):
        osm_levels = [int(level) for level in re.findall(r"[+-]?\d+", text)]
        return "ground" if 0 in osm_levels else "non_ground"
    return "unknown"


def request_json(url: str, *, timeout: int = 120) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "jinbocho-street-atlas/0.1 (https://github.com/builtbyko/jinbocho)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def fetch_osm(boundary_union) -> dict[str, Any]:
    minx, miny, maxx, maxy = boundary_union.bounds
    margin = 0.00055
    bbox = f"{miny - margin},{minx - margin},{maxy + margin},{maxx + margin}"
    query = f"""
[out:json][timeout:120];
(
  way[\"building\"]({bbox});
  nwr[\"shop\"]({bbox});
  nwr[\"amenity\"~\"^(cafe|restaurant|fast_food|bar|pub|food_court|library|theatre|cinema|arts_centre|school|college|university)$\"]({bbox});
  nwr[\"tourism\"~\"^(museum|gallery)$\"]({bbox});
  way[\"highway\"~\"^(service|footway|pedestrian|living_street|steps|path|corridor)$\"]({bbox});
);
out center tags geom;
""".strip()
    endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
    errors: list[str] = []
    for endpoint in endpoints:
        try:
            url = f"{endpoint}?data={urllib.parse.quote(query)}"
            data = request_json(url, timeout=180)
            data["_atlas_query"] = query
            data["_atlas_retrieved_at"] = datetime.now(timezone.utc).isoformat()
            compact_write(OSM_PATH, data)
            return data
        except Exception as exc:  # noqa: BLE001 - endpoint fallback is intentional
            errors.append(f"{endpoint}: {exc}")
    raise RuntimeError("Overpass request failed: " + " | ".join(errors))


def geocode_address(address: str, cache: dict[str, Any], allow_fetch: bool) -> list[float] | None:
    if address in cache:
        value = cache[address]
        return value if isinstance(value, list) else None
    if not allow_fetch:
        return None
    url = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + urllib.parse.quote(address)
    try:
        data = request_json(url, timeout=30)
        coordinates = data[0]["geometry"]["coordinates"] if data else None
        cache[address] = coordinates
        time.sleep(0.18)
        return coordinates
    except Exception as exc:  # noqa: BLE001 - an unmatched record is reported later
        print(f"warning: geocode failed for {address}: {exc}", file=sys.stderr)
        cache[address] = None
        return None


def element_point(element: dict[str, Any]) -> Point | None:
    if "lat" in element and "lon" in element:
        return Point(float(element["lon"]), float(element["lat"]))
    center = element.get("center")
    if center:
        return Point(float(center["lon"]), float(center["lat"]))
    geometry = element.get("geometry") or []
    coords = [(item["lon"], item["lat"]) for item in geometry if "lon" in item and "lat" in item]
    if coords:
        line = LineString(coords)
        return line.centroid
    return None


def classify(tags: dict[str, str]) -> str | None:
    shop = tags.get("shop")
    amenity = tags.get("amenity")
    tourism = tags.get("tourism")
    if shop == "books":
        if tags.get("second_hand") in {"yes", "only"} or re.search(r"古書|古本", tags.get("name", "")):
            return "antiquarian_bookstore"
        return "bookstore"
    if amenity == "cafe":
        return "cafe"
    if amenity in {"restaurant", "fast_food", "bar", "pub", "food_court"}:
        return "restaurant"
    if amenity in {"library", "theatre", "cinema", "arts_centre"} or tourism in {"museum", "gallery"}:
        return "culture"
    if amenity in {"school", "college", "university"}:
        return "education"
    if shop:
        return "retail"
    return None


def osm_address(tags: dict[str, str]) -> str | None:
    pieces = [tags.get("addr:city"), tags.get("addr:quarter") or tags.get("addr:suburb"), tags.get("addr:block_number"), tags.get("addr:housenumber")]
    value = "".join(str(piece) for piece in pieces if piece)
    return value or tags.get("addr:full")


def load_osm_places_and_alleys(osm_data: dict[str, Any], boundary_union):
    places: list[dict[str, Any]] = []
    alleys: list[dict[str, Any]] = []
    for element in osm_data.get("elements", []):
        tags = element.get("tags") or {}
        geometry = element.get("geometry") or []
        highway = tags.get("highway")
        if element.get("type") == "way" and highway in {"service", "footway", "pedestrian", "living_street", "steps", "path", "corridor"}:
            coords = [(item["lon"], item["lat"]) for item in geometry if "lon" in item and "lat" in item]
            if len(coords) >= 2:
                line = LineString(coords)
                if line.intersects(boundary_union):
                    kind = "steps" if highway == "steps" else "pedestrian" if highway in {"footway", "pedestrian", "path", "corridor"} else "alley"
                    alleys.append(
                        {
                            "type": "Feature",
                            "properties": {
                                "id": f"osm-way-{element['id']}",
                                "osmId": element["id"],
                                "kind": kind,
                                "highway": highway,
                                "name": tags.get("name"),
                                "access": tags.get("access"),
                                "covered": tags.get("covered") == "yes" or tags.get("tunnel") == "building_passage",
                                "source": OSM_COPYRIGHT,
                                "observedAt": OBSERVED_DATE,
                            },
                            "geometry": mapping(line.intersection(boundary_union)),
                        }
                    )

        category = classify(tags)
        name = tags.get("name") or tags.get("name:ja")
        point = element_point(element)
        if not category or not name or point is None or not point.intersects(boundary_union):
            continue
        place_id = f"osm-{element['type']}-{element['id']}"
        website = tags.get("contact:website") or tags.get("website")
        places.append(
            {
                "type": "Feature",
                "properties": {
                    "id": place_id,
                    "osmId": element["id"],
                    "name": name,
                    "category": category,
                    "subcategory": tags.get("cuisine") or tags.get("shop") or tags.get("amenity"),
                    "floor": tags.get("level"),
                    "address": osm_address(tags),
                    "era": "unknown",
                    "hours": tags.get("opening_hours"),
                    "website": website,
                    "sourceLabel": "OpenStreetMap",
                    "sourceUrl": f"https://www.openstreetmap.org/{element['type']}/{element['id']}",
                    "sourceType": "open_data",
                    "observedAt": OBSERVED_DATE,
                    "confidence": "reference",
                },
                "geometry": mapping(point),
            }
        )
    return places, alleys


def osm_buildings(osm_data: dict[str, Any], boundary_union) -> gpd.GeoDataFrame:
    records: list[dict[str, Any]] = []
    for element in osm_data.get("elements", []):
        tags = element.get("tags") or {}
        if element.get("type") != "way" or "building" not in tags:
            continue
        coords = [(item["lon"], item["lat"]) for item in element.get("geometry", []) if "lon" in item and "lat" in item]
        if len(coords) < 4:
            continue
        if coords[0] != coords[-1]:
            coords.append(coords[0])
        polygon = Polygon(coords)
        if polygon.is_valid and polygon.area > 0 and polygon.centroid.intersects(boundary_union):
            records.append(
                {
                    "source_id": f"osm-way-{element['id']}",
                    "floors": tags.get("building:levels"),
                    "area_sqm": None,
                    "source": OSM_COPYRIGHT,
                    "observed_at": OBSERVED_DATE,
                    "geometry": polygon,
                }
            )
    return gpd.GeoDataFrame(records, crs="EPSG:4326")


def official_buildings(source: Path, boundary_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    projected_boundary = boundary_gdf.to_crs(6677)
    bbox = tuple(projected_boundary.total_bounds)
    print(f"Reading official building source within {bbox}")
    buildings = gpd.read_file(source, bbox=bbox, engine="pyogrio", encoding="cp932", fid_as_index=True)
    if buildings.crs is None:
        buildings = buildings.set_crs(6677)
    buildings = buildings[buildings.geometry.notna() & ~buildings.geometry.is_empty].copy()
    mask = unary_union(projected_boundary.geometry)
    buildings = buildings[buildings.geometry.intersects(mask)].copy()
    buildings["geometry"] = buildings.geometry.intersection(mask)
    buildings = buildings[buildings.geometry.geom_type.isin(["Polygon", "MultiPolygon"])]
    buildings["source_id"] = buildings.index.astype(str)
    floor_column = next((column for column in ["BV_3", "階数"] if column in buildings.columns), None)
    buildings["floors"] = buildings[floor_column] if floor_column else None
    buildings["area_sqm"] = buildings.geometry.area.round(1)
    buildings["source"] = TOKYO_BUILDING_SOURCE
    buildings["observed_at"] = "2021年度"
    buildings["geometry"] = buildings.geometry.simplify(0.05, preserve_topology=True)
    return buildings[["source_id", "floors", "area_sqm", "source", "observed_at", "geometry"]].to_crs(4326)


def match_curated(
    osm_places: list[dict[str, Any]], curated: dict[str, Any], geocodes: dict[str, Any], allow_fetch: bool
) -> tuple[list[dict[str, Any]], list[str]]:
    by_normalized: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in osm_places:
        by_normalized[normalize_name(feature["properties"]["name"])].append(feature)

    used_osm_ids: set[str] = set()
    curated_features: list[dict[str, Any]] = []
    unmatched: list[str] = []
    for record in curated.get("places", []):
        names = [record["name"], *(record.get("aliases") or [])]
        candidates: list[dict[str, Any]] = []
        for name in names:
            normalized = normalize_name(name)
            candidates.extend(by_normalized.get(normalized, []))
            if not candidates and len(normalized) >= 4:
                for key, values in by_normalized.items():
                    if normalized in key or key in normalized:
                        candidates.extend(values)
        point: Point | None = None
        osm_id: int | None = None
        if candidates:
            candidate = candidates[0]
            point = shape(candidate["geometry"])
            osm_id = candidate["properties"].get("osmId")
            used_osm_ids.add(candidate["properties"]["id"])
        if point is None:
            coordinates = record.get("coordinates") or geocode_address(record["address"], geocodes, allow_fetch)
            if coordinates:
                point = Point(coordinates)
        if point is None:
            unmatched.append(record["id"])
            continue
        props = {
            **record,
            "osmId": osm_id,
            "era": era_for_year(record.get("foundedYear")),
            "observedAt": curated.get("checkedAt", OBSERVED_DATE),
        }
        props.pop("coordinates", None)
        curated_features.append({"type": "Feature", "properties": props, "geometry": mapping(point)})

    remaining = [feature for feature in osm_places if feature["properties"]["id"] not in used_osm_ids]
    return remaining + curated_features, unmatched


def assign_places(buildings: gpd.GeoDataFrame, places: list[dict[str, Any]]) -> tuple[gpd.GeoDataFrame, list[dict[str, Any]]]:
    building_ids = [f"building-{source_id}" for source_id in buildings["source_id"].astype(str)]
    buildings = buildings.copy()
    buildings["atlas_id"] = building_ids
    spatial_index = buildings.sindex
    places_by_building: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for feature in places:
        point = shape(feature["geometry"])
        indices = list(spatial_index.query(point, predicate="intersects"))
        if not indices:
            nearest = list(spatial_index.nearest(point, max_distance=0.00022))
            if len(nearest) == 2 and len(nearest[1]):
                indices = [int(nearest[1][0])]
        if indices:
            index = int(indices[0])
            building_id = buildings.iloc[index]["atlas_id"]
            feature["properties"]["buildingId"] = building_id
            places_by_building[building_id].append(feature)

    priority = {
        "antiquarian_bookstore": 0,
        "bookstore": 1,
        "cafe": 2,
        "restaurant": 3,
        "culture": 4,
        "education": 4,
        "retail": 5,
        "service": 5,
        "other": 6,
    }
    props_list: list[dict[str, Any]] = []
    for _, row in buildings.iterrows():
        building_id = row["atlas_id"]
        occupants = places_by_building.get(building_id, [])
        categories = [item["properties"]["category"] for item in occupants]
        ground_occupants = [item for item in occupants if floor_position(item["properties"].get("floor")) == "ground"]
        unknown_floor_occupants = [
            item for item in occupants if floor_position(item["properties"].get("floor")) == "unknown"
        ]
        if ground_occupants:
            primary_candidates = ground_occupants
            primary_basis = "confirmed_ground_floor"
        elif unknown_floor_occupants:
            primary_candidates = unknown_floor_occupants
            primary_basis = "floor_unverified"
        else:
            primary_candidates = []
            primary_basis = "upper_or_basement_only" if occupants else "no_place"
        primary_categories = [item["properties"]["category"] for item in primary_candidates]
        primary = (
            min(primary_categories, key=lambda category: priority.get(category, 99))
            if primary_categories
            else "unclassified"
        )
        bookstores = [
            item for item in occupants if item["properties"]["category"] in {"antiquarian_bookstore", "bookstore"}
        ]
        known_years = [item["properties"].get("foundedYear") for item in bookstores if item["properties"].get("foundedYear")]
        oldest = min(known_years) if known_years else None
        floor_value = row.get("floors")
        if isinstance(floor_value, float) and math.isnan(floor_value):
            floor_value = None
        props_list.append(
            {
                "id": building_id,
                "sourceId": str(row["source_id"]),
                "floors": floor_value,
                "areaSqm": row.get("area_sqm"),
                "primaryUse": primary,
                "primaryUseBasis": primary_basis,
                "placeCount": len(occupants),
                "placeIds": [item["properties"]["id"] for item in occupants],
                "placeNames": [item["properties"]["name"] for item in occupants],
                "hasBookstore": bool(bookstores),
                "hasCafe": "cafe" in categories,
                "hasRestaurant": "restaurant" in categories,
                "bookstoreEra": era_for_year(oldest),
                "oldestBookstoreYear": oldest,
                "mixedUse": len(set(categories)) > 1 or len(occupants) > 1,
                "source": row["source"],
                "observedAt": row["observed_at"],
            }
        )
    buildings["properties"] = props_list
    return buildings, places


def feature_collection(features: list[dict[str, Any]], **metadata: Any) -> dict[str, Any]:
    value: dict[str, Any] = {"type": "FeatureCollection", "features": features}
    if metadata:
        value["metadata"] = metadata
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch", action="store_true", help="Refresh Overpass and geocoding caches")
    parser.add_argument("--building-source", type=Path, default=Path(os.getenv("JINBOCHO_BUILDING_SOURCE", DEFAULT_BUILDING_SOURCE)))
    args = parser.parse_args()

    boundary = load_json(BOUNDARY_PATH)
    boundary_gdf = gpd.GeoDataFrame.from_features(boundary["features"], crs="EPSG:4326")
    boundary_union = unary_union(boundary_gdf.geometry)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    if args.fetch or not OSM_PATH.exists():
        osm_data = fetch_osm(boundary_union)
    else:
        osm_data = load_json(OSM_PATH)
    global OBSERVED_DATE
    osm_timestamp = osm_data.get("osm3s", {}).get("timestamp_osm_base") or osm_data.get("_atlas_retrieved_at")
    if osm_timestamp:
        OBSERVED_DATE = str(osm_timestamp).split("T", maxsplit=1)[0]
    osm_places, alleys = load_osm_places_and_alleys(osm_data, boundary_union)

    if args.building_source.exists():
        buildings = official_buildings(args.building_source, boundary_gdf)
        building_source_label = TOKYO_BUILDING_SOURCE
    else:
        print(f"warning: official building source not found at {args.building_source}; using OSM building ways", file=sys.stderr)
        buildings = osm_buildings(osm_data, boundary_union)
        building_source_label = OSM_COPYRIGHT
    if buildings.empty:
        raise RuntimeError("No building polygons were generated")

    curated = load_json(CURATED_PATH)
    geocodes = load_json(GEOCODE_PATH) if GEOCODE_PATH.exists() else {}
    places, unmatched = match_curated(osm_places, curated, geocodes, args.fetch)
    compact_write(GEOCODE_PATH, geocodes)
    if unmatched:
        print("warning: curated places without coordinates: " + ", ".join(unmatched), file=sys.stderr)

    buildings, places = assign_places(buildings, places)
    building_features = [
        {"type": "Feature", "properties": row["properties"], "geometry": mapping(row.geometry)}
        for _, row in buildings.iterrows()
    ]
    building_features.sort(key=lambda item: item["properties"]["id"])
    places.sort(key=lambda item: (item["properties"]["category"], item["properties"]["name"]))
    alleys.sort(key=lambda item: item["properties"]["id"])

    compact_write(PUBLIC_DIR / "boundary.geojson", boundary)
    compact_write(
        PUBLIC_DIR / "buildings.geojson",
        feature_collection(
            building_features,
            source=building_source_label,
            processedAt=datetime.now(timezone.utc).date().isoformat(),
            note="神田神保町一〜三丁目で切り出し、WGS84へ変換。店舗との空間結合はATLASによる。",
        ),
    )
    compact_write(
        PUBLIC_DIR / "places.geojson",
        feature_collection(places, osmAttribution=OSM_COPYRIGHT, curatedCheckedAt=curated.get("checkedAt")),
    )
    compact_write(
        PUBLIC_DIR / "alleys.geojson",
        feature_collection(alleys, osmAttribution=OSM_COPYRIGHT, note="OSM上の歩行者道・細街路等。通行可否と網羅性は保証しない。"),
    )

    category_counts = Counter(item["properties"]["category"] for item in places)
    curated_count = sum(item["properties"].get("confidence") == "confirmed" for item in places)
    era_count = sum(
        bool(
            item["properties"]["category"] in {"antiquarian_bookstore", "bookstore"}
            and item["properties"].get("foundedYear")
        )
        for item in places
    )
    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "osmObservedAt": OBSERVED_DATE,
        "scope": "神田神保町一丁目・二丁目・三丁目",
        "buildingCount": len(building_features),
        "placeCount": len(places),
        "bookstoreCount": category_counts["antiquarian_bookstore"] + category_counts["bookstore"],
        "bookstoreEraCount": era_count,
        "cafeCount": category_counts["cafe"],
        "restaurantCount": category_counts["restaurant"],
        "alleyCount": len(alleys),
        "curatedPlaceCount": curated_count,
        "unmatchedCuratedIds": unmatched,
        "caveats": [
            "建物色は階情報がある場合は地上階を優先し、階情報がない店舗は路面店候補として扱った目安です。建物全体の用途ではありません。",
            "OSM由来の店舗・路地は参考情報で、営業状況・網羅性・通行可否を保証しません。",
            "創業年、神保町での開業年、現在地への移転年を別々に記録しています。",
            "飲食店のレビュー点数は収録せず、公式掲載や受賞歴など出典が追える根拠だけを表示します。",
        ],
    }
    compact_write(PUBLIC_DIR / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
