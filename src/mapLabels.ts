import type { FeatureCollection, Polygon, Position } from "geojson";
import type { AtlasData, BuildingProperties, LayerKey, PlaceProperties } from "./types";

type LabelProperties = { id: string; name: string; otherShops: string; priority: number; confirmed: boolean };

function isCategoryVisible(place: PlaceProperties, layers: Record<LayerKey, boolean>) {
  const category = place.category;
  if (category === "antiquarian_bookstore" || category === "bookstore" || category === "cafe" || category === "restaurant") {
    return layers[category];
  }
  return layers.other;
}

// Match the data builder's distinction between Japanese 1階 and OSM level=0.
function floorPriority(value?: string) {
  const text = value?.trim() ?? "";
  if (!text) return 1;
  const japaneseLevels = [...text.replace(/地下\s*\d+\s*階/g, "").matchAll(/(\d+)\s*階/g)].map((match) => Number(match[1]));
  if (japaneseLevels.length) return japaneseLevels.includes(1) ? 0 : 2;
  if (/地下\s*\d+\s*階/.test(text)) return 2;
  const upper = text.toUpperCase();
  const floorLevels = [...upper.replace(/B\s*\d+\s*F/g, "").matchAll(/(\d+)\s*F/g)].map((match) => Number(match[1]));
  if (floorLevels.length) return floorLevels.includes(1) ? 0 : 2;
  if (/B\s*\d+\s*F/.test(upper)) return 2;
  if (/^[+-]?\d+(?:\s*[,;]\s*[+-]?\d+)*$/.test(text)) {
    return text.split(/[,;]/).map(Number).includes(0) ? 0 : 2;
  }
  return 1;
}

function representativePriority(place: PlaceProperties, building: BuildingProperties) {
  return floorPriority(place.floor) * 4
    + (place.category === building.primaryUse ? 0 : 2)
    + (place.confidence === "confirmed" ? 0 : 1);
}

function ringArea(ring: Position[]) {
  return Math.abs(ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0));
}

export function buildingLabelData(data: AtlasData, layers: Record<LayerKey, boolean>): FeatureCollection<Polygon, LabelProperties> {
  const occupantsByBuilding = new Map<string, PlaceProperties[]>();
  for (const { properties: place } of data.places.features) {
    if (!place.buildingId) continue;
    const occupants = occupantsByBuilding.get(place.buildingId) ?? [];
    occupants.push(place);
    occupantsByBuilding.set(place.buildingId, occupants);
  }

  const result: FeatureCollection<Polygon, LabelProperties> = { type: "FeatureCollection", features: [] };
  for (const building of data.buildings.features) {
    const occupants = occupantsByBuilding.get(building.properties.id) ?? [];
    const candidates = occupants.filter((place) => isCategoryVisible(place, layers)
      || (layers.bookEra && (place.category === "antiquarian_bookstore" || place.category === "bookstore") && place.era !== "unknown"));
    const confirmedCandidates = candidates.filter((place) => place.confidence === "confirmed");
    const representatives = confirmedCandidates.length ? confirmedCandidates : candidates;
    representatives.sort((a, b) => representativePriority(a, building.properties) - representativePriority(b, building.properties)
      || a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id));
    const representative = representatives[0];
    if (!representative) continue;

    // A MultiPolygon otherwise produces several labels; use its largest actual footprint.
    const geometry: Polygon = building.geometry.type === "Polygon"
      ? building.geometry
      : { type: "Polygon", coordinates: building.geometry.coordinates.reduce((largest, polygon) => ringArea(polygon[0]) > ringArea(largest[0]) ? polygon : largest) };
    result.features.push({
      type: "Feature",
      geometry,
      properties: {
        id: building.properties.id,
        name: representative.name,
        otherShops: occupants.length > 1 ? `\nほか${occupants.length - 1}店` : "",
        priority: (representative.confidence === "confirmed" ? 0 : 20) + representativePriority(representative, building.properties),
        confirmed: representative.confidence === "confirmed",
      },
    });
  }
  return result;
}
