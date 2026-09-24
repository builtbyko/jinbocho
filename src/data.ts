import type { AtlasData } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  if (!response.ok) {
    throw new Error(`${path} の読込に失敗しました (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function loadAtlasData(): Promise<AtlasData> {
  const [boundary, basemapRoads, basemapSidewalks, basemapRoadNames, buildings, places, alleys, summary] = await Promise.all([
    getJson<AtlasData["boundary"]>("boundary.geojson"),
    getJson<AtlasData["basemapRoads"]>("basemap-roads.geojson"),
    getJson<AtlasData["basemapSidewalks"]>("basemap-sidewalks.geojson"),
    getJson<AtlasData["basemapRoadNames"]>("basemap-road-names.geojson"),
    getJson<AtlasData["buildings"]>("buildings.geojson"),
    getJson<AtlasData["places"]>("places.geojson"),
    getJson<AtlasData["alleys"]>("alleys.geojson"),
    getJson<AtlasData["summary"]>("summary.json"),
  ]);

  return { boundary, basemapRoads, basemapSidewalks, basemapRoadNames, buildings, places, alleys, summary };
}
