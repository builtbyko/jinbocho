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
  if (record.lookFor) {
    assert(published?.lookFor === record.lookFor && /^https:\/\//.test(record.lookForSourceUrl), `${record.id}: look-for text or source is missing`);
  }
  if (record.photo) {
    const photo = record.photo;
    assert(/^photos\/[a-z0-9.-]+$/.test(photo.src) && fs.existsSync(path.join(root,"public",photo.src)), `${record.id}: photo asset is missing`);
    assert(photo.author && photo.license && photo.takenAt && /^https:\/\//.test(photo.sourceUrl), `${record.id}: photo attribution is incomplete`);
    assert(JSON.stringify(published.photo) === JSON.stringify(photo), `${record.id}: photo is not synced`);
  }
  assert(published?.description === record.description, `curated ${record.id} is not synced to the map`);
  assert(published?.observedAt === (record.checkedAt ?? curated.checkedAt), `curated ${record.id} has an outdated checked date`);
}

const migration = read("data/curated/bookwalk-migration.json");
assert(migration.records.length === 15, "bookwalk migration must retain all 15 places");
for (const entry of migration.records) {
  const matches = places.features.filter(f => f.properties.id === entry.targetId);
  assert(matches.length === 1, `migrated ${entry.targetId} must exist exactly once`);
  const p = matches[0].properties;
  assert(p.foundingDisplay && p.buildingCompletedText && p.historySources?.length, `migrated ${p.id} lacks dates or sources`);
  assert(p.historySources.every(s => /^https:\/\//.test(s.url) && s.label), `migrated ${p.id} has an invalid source`);
}
const byPlaceId = new Map(places.features.map(f => [f.properties.id, f.properties]));
const byBuildingId = new Map(buildings.features.map(f => [f.properties.id, f.properties]));
for (const {properties: p} of places.features) {
  if (p.buildingId) assert(byBuildingId.get(p.buildingId)?.placeIds.includes(p.id), `${p.id}: building tenant index is stale`);
}
for (const {properties: b} of buildings.features) {
  assert(b.placeCount === b.placeIds.length, `${b.id}: tenant count mismatch`);
  assert(b.placeIds.every(id => byPlaceId.get(id)?.buildingId === b.id), `${b.id}: missing or mismatched tenant`);
}
const facade = places.features.find(f => f.properties.bookwalkImported && f.properties.name === "文房堂")?.properties;
assert(facade?.originalFacadeYear === 1922 && facade?.buildingRebuiltYear === 1990 && !facade?.buildingCompletedYear,
  "文房堂 must distinguish the preserved facade from the rebuilt building");

assert(summary.buildingCount === buildings.features.length, "summary buildingCount mismatch");
assert(summary.placeCount === places.features.length, "summary placeCount mismatch");
assert(summary.alleyCount === alleys.features.length, "summary alleyCount mismatch");

console.log(`Validated ${buildings.features.length} buildings, ${places.features.length} places, ${alleys.features.length} alleys.`);

const planning = read("public/data/planning-areas.geojson");
assert(planning.features.length === 2, "planning areas must include regeneration and district plan");
for (const f of planning.features) {
 assert(f.properties.sourceUrl?.startsWith("https://") && f.properties.geometryMethod, "planning provenance missing");
 assert(["Polygon","MultiPolygon"].includes(f.geometry.type), "planning geometry must be a polygon");
 const visit=c=>{ if(typeof c[0]==="number") assert(c[0]>139.74 && c[0]<139.77 && c[1]>35.68 && c[1]<35.71,"planning coordinates outside Jinbocho"); else c.forEach(visit); };
 visit(f.geometry.coordinates);
}
const roadClasses=read("public/data/road-classification.geojson");
assert(roadClasses.features.length>0,"road classification missing");
for(const f of roadClasses.features){
 assert(["national","metropolitan","ward","private","restricted","unknown"].includes(f.properties.roadKind),"invalid road kind");
 assert(f.properties.sourceUrl?.startsWith("https://"),"road provenance missing");
 assert(f.properties.roadKind!=="private" || f.properties.confidence==="confirmed","unverified roads must not be marked private");
}
const labels=read("public/data/basemap-road-names.geojson");
for(const [name,number] of [["白山通り","301"],["靖国通り","302"]]){
 const p=labels.features.find(f=>f.properties.name===name)?.properties;
 assert(p?.routeNumber===number && p?.routeIcon===`route-${number}`,`${name}: route shield missing`);
}
