import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const boundary = read("public/data/boundary.geojson");
const basemapRoads = read("public/data/basemap-roads.geojson");
const basemapSidewalks = read("public/data/basemap-sidewalks.geojson");
const basemapRoadNames = read("public/data/basemap-road-names.geojson");
const buildings = read("public/data/buildings.geojson");
const places = read("public/data/places.geojson");
const alleys = read("public/data/alleys.geojson");
const summary = read("public/data/summary.json");
const curated = read("data/curated/places.json");

for (const [name, collection] of Object.entries({ boundary, basemapRoads, basemapSidewalks, basemapRoadNames, buildings, places, alleys })) {
  assert(collection.type === "FeatureCollection", `${name} must be a FeatureCollection`);
  assert(Array.isArray(collection.features), `${name}.features must be an array`);
}

assert(boundary.features.length === 3, "boundary must contain the three 神田神保町 towns");
assert(basemapRoads.features.length > 0, "white basemap roads are missing");
assert(basemapSidewalks.features.length > 0, "mapped sidewalks are missing");
assert(
  ["靖国通り", "白山通り", "すずらん通り"].every((name) => basemapRoadNames.features.some((feature) => feature.properties?.name === name)),
  "main street labels are missing",
);
for (const [name, collection] of Object.entries({ basemapRoads, basemapSidewalks, basemapRoadNames })) {
  assert(collection.metadata?.source?.includes("OpenStreetMap"), `${name} lacks OSM attribution`);
}
assert(buildings.features.length > 100, "building coverage is unexpectedly small");
assert(places.features.length >= curated.places.length, "curated places are missing from public data");
assert(alleys.features.length > 10, "alley coverage is unexpectedly small");

for (const [name, collection] of Object.entries({ buildings, places, alleys })) {
  const ids = collection.features.map((feature) => feature.properties?.id).filter(Boolean);
  assert(ids.length === collection.features.length, `${name} contains a feature without an id`);
  assert(new Set(ids).size === ids.length, `${name} contains duplicate ids`);
}

for (const feature of places.features) {
  const p = feature.properties;
  assert(p.name && p.category, `place ${p.id} lacks name/category`);
  assert(p.sourceUrl && p.sourceLabel && p.observedAt, `place ${p.id} lacks provenance`);
}

for (const feature of buildings.features) {
  const p = feature.properties;
  assert(p.sourceId && p.source && p.observedAt, `building ${p.id} lacks provenance`);
}

for (const record of curated.places) {
  assert(record.id && record.name && record.address, "curated record lacks identity/address");
  assert(record.sourceUrl && record.sourceLabel && record.sourceType, `curated ${record.id} lacks provenance`);
  assert(record.description?.trim(), `curated ${record.id} lacks a short introduction`);
  const published = places.features.find((feature) => feature.properties.id === record.id)?.properties;
  assert(published?.description === record.description, `curated ${record.id} is not synced to the map`);
  assert(published?.observedAt === curated.checkedAt, `curated ${record.id} has an outdated checked date`);
}

assert(summary.buildingCount === buildings.features.length, "summary buildingCount mismatch");
assert(summary.placeCount === places.features.length, "summary placeCount mismatch");
assert(summary.alleyCount === alleys.features.length, "summary alleyCount mismatch");

console.log(`Validated ${buildings.features.length} buildings, ${places.features.length} places, ${alleys.features.length} alleys.`);
