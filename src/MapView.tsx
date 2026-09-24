import { useEffect, useMemo, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type {
  ExpressionSpecification,
  Map as MapLibreMap,
  MapMouseEvent,
  MapGeoJSONFeature,
} from "maplibre-gl";
import type { AtlasData, LayerKey } from "./types";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

type Props = {
  data: AtlasData;
  visibleLayers: Record<LayerKey, boolean>;
  selectedBuildingId?: string;
  focusPlaceId?: string;
  onSelectBuilding: (id?: string) => void;
};

const USE_COLOR: ExpressionSpecification = [
  "match",
  ["get", "primaryUse"],
  "antiquarian_bookstore",
  "#a6533c",
  "bookstore",
  "#d98a4e",
  "cafe",
  "#4f7f78",
  "restaurant",
  "#7f6b9f",
  "retail",
  "#7389a6",
  "culture",
  "#b29a45",
  "education",
  "#b29a45",
  "service",
  "#7389a6",
  "#d9d4c8",
];

const ERA_COLOR: ExpressionSpecification = [
  "case",
  ["!", ["get", "hasBookstore"]],
  "#ddd9cf",
  [
    "match",
    ["get", "bookstoreEra"],
    "prewar",
    "#6c3328",
    "1945-1969",
    "#9e5540",
    "1970-1999",
    "#c67b55",
    "2000-present",
    "#e3aa75",
    "#c9c4b8",
  ],
];

function getFeatureId(feature: MapGeoJSONFeature | undefined) {
  return String(feature?.properties?.id ?? "") || undefined;
}

function categoryFilter(visibleLayers: Record<LayerKey, boolean>): ExpressionSpecification {
  const categories = (["antiquarian_bookstore", "bookstore", "cafe", "restaurant"] as const)
    .filter((category) => visibleLayers[category]);
  const enabled = visibleLayers.other
    ? [...categories, "retail", "culture", "education", "service", "other"]
    : categories;
  return enabled.length
    ? ["in", ["get", "primaryUse"], ["literal", enabled]]
    : ["==", ["get", "primaryUse"], "__none__"];
}

function syncLayers(map: MapLibreMap, visibleLayers: Record<LayerKey, boolean>) {
  if (!map.getLayer("buildings-fill")) return;
  const baseVisibility = visibleLayers.buildings ? "visible" : "none";
  map.setLayoutProperty("buildings-fill", "visibility", baseVisibility);
  map.setLayoutProperty("buildings-outline", "visibility", baseVisibility);
  const visibleCategories = categoryFilter(visibleLayers);
  map.setFilter("buildings-category", visibleCategories);
  map.setLayoutProperty("buildings-era", "visibility", visibleLayers.bookEra ? "visible" : "none");
  const eraBuildings: ExpressionSpecification = ["all", ["==", ["get", "hasBookstore"], true], ["!=", ["get", "bookstoreEra"], "unknown"]];
  map.setFilter(
    "building-hit",
    visibleLayers.buildings
      ? [">", ["get", "placeCount"], 0]
      : visibleLayers.bookEra
        ? ["any", visibleCategories, eraBuildings]
        : visibleCategories,
  );
  const alleyVisibility = visibleLayers.alleys ? "visible" : "none";
  map.setLayoutProperty("alleys-casing", "visibility", alleyVisibility);
  map.setLayoutProperty("alleys-line", "visibility", alleyVisibility);
}

function syncBuildingSelection(map: MapLibreMap, selectedBuildingId?: string) {
  if (!map.getLayer("building-selected") || !map.getLayer("building-selected-core")) return;
  const filter: ExpressionSpecification = ["==", ["get", "id"], selectedBuildingId ?? ""];
  map.setFilter("building-selected", filter);
  map.setFilter("building-selected-core", filter);
}

export default function MapView({
  data,
  visibleLayers,
  selectedBuildingId,
  focusPlaceId,
  onSelectBuilding,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap>();
  const callbacksRef = useRef({ onSelectBuilding });
  const visibleLayersRef = useRef(visibleLayers);
  const selectedBuildingIdRef = useRef(selectedBuildingId);
  callbacksRef.current = { onSelectBuilding };
  visibleLayersRef.current = visibleLayers;
  selectedBuildingIdRef.current = selectedBuildingId;

  const placeById = useMemo(
    () => new Map(data.places.features.map((feature) => [feature.properties.id, feature])),
    [data.places.features],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [139.7572, 35.69625],
      zoom: 16.35,
      minZoom: 15,
      maxZoom: 20,
      maxBounds: [
        [139.747, 35.689],
        [139.767, 35.7035],
      ],
      attributionControl: false,
      style: {
        version: 8,
        sources: {},
        layers: [{
          id: "paper",
          type: "background",
          paint: { "background-color": "#f1f0ec" },
        }],
      },
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>',
      }),
      "bottom-right",
    );

    map.on("load", () => {
      map.addSource("boundary", { type: "geojson", data: data.boundary });
      map.addSource("basemap-roads", { type: "geojson", data: data.basemapRoads });
      map.addSource("basemap-sidewalks", { type: "geojson", data: data.basemapSidewalks });
      map.addSource("basemap-road-names", { type: "geojson", data: data.basemapRoadNames });
      map.addSource("buildings", { type: "geojson", data: data.buildings, promoteId: "id" });
      map.addSource("alleys", { type: "geojson", data: data.alleys });

      map.addLayer({
        id: "scope-mask",
        type: "fill",
        source: "boundary",
        paint: { "fill-color": "#faf9f5", "fill-opacity": 1 },
      });
      map.addLayer({
        id: "road-surface",
        type: "fill",
        source: "basemap-roads",
        paint: { "fill-color": "#e9ebe8", "fill-opacity": 1 },
      });
      map.addLayer({
        id: "road-edge",
        type: "line",
        source: "basemap-roads",
        paint: { "line-color": "#cfd3cf", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.4, 19, 0.9], "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "mapped-sidewalk",
        type: "fill",
        source: "basemap-sidewalks",
        paint: { "fill-color": "#fbfaf7", "fill-opacity": 1 },
      });
      map.addLayer({
        id: "mapped-sidewalk-edge",
        type: "line",
        source: "basemap-sidewalks",
        paint: { "line-color": "#d8dbd6", "line-width": 0.55, "line-opacity": 0.8 },
      });
      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        minzoom: 14.3,
        paint: {
          "fill-color": "#dadbd6",
          "fill-opacity": 0.96,
        },
      });
      map.addLayer({
        id: "buildings-category",
        type: "fill",
        source: "buildings",
        minzoom: 14.3,
        filter: categoryFilter(visibleLayersRef.current),
        paint: { "fill-color": USE_COLOR, "fill-opacity": 0.82 },
      });
      map.addLayer({
        id: "buildings-era",
        type: "fill",
        source: "buildings",
        minzoom: 14.3,
        filter: ["all", ["==", ["get", "hasBookstore"], true], ["!=", ["get", "bookstoreEra"], "unknown"]],
        layout: { visibility: "none" },
        paint: { "fill-color": ERA_COLOR, "fill-opacity": 0.9 },
      });
      map.addLayer({
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        minzoom: 14.3,
        paint: {
          "line-color": "#717a73",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.3, 18, 0.58],
          "line-width": ["interpolate", ["linear"], ["zoom"], 14.3, 0.35, 19, 1.1],
        },
      });
      map.addLayer({
        id: "building-hit",
        type: "fill",
        source: "buildings",
        minzoom: 14.3,
        paint: { "fill-color": "#000000", "fill-opacity": 0 },
      });
      map.addLayer({
        id: "building-hover",
        type: "line",
        source: "buildings",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#1d2926", "line-width": 2.2, "line-opacity": 0.95 },
      });
      map.addLayer({
        id: "building-selected",
        type: "line",
        source: "buildings",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#fff", "line-width": 5, "line-opacity": 0.95 },
      });
      map.addLayer({
        id: "building-selected-core",
        type: "line",
        source: "buildings",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#1f2b28", "line-width": 2.4, "line-opacity": 1 },
      });
      map.addLayer({
        id: "alleys-casing",
        type: "line",
        source: "alleys",
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#fffdf7",
          "line-width": ["interpolate", ["linear"], ["zoom"], 15, 2, 19, 6],
          "line-opacity": 0.92,
        },
      });
      map.addLayer({
        id: "alleys-line",
        type: "line",
        source: "alleys",
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "kind"], "steps", "#a6533c", "pedestrian", "#265f58", "#495753"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.8, 19, 2.5],
          "line-dasharray": [2, 1.3],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "boundary-line",
        type: "line",
        source: "boundary",
        paint: { "line-color": "#a9aea9", "line-width": 0.9, "line-opacity": 0.65, "line-dasharray": [3, 3] },
      });
      map.addLayer({
        id: "road-names",
        type: "symbol",
        source: "basemap-road-names",
        minzoom: 15,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 900,
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans CJK JP", "Yu Gothic", "Meiryo", "sans-serif"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 15, 11, 18, 13],
          "text-letter-spacing": 0.07,
          "text-padding": 8,
          "text-keep-upright": true,
        },
        paint: { "text-color": "#59665e", "text-halo-color": "#faf9f5", "text-halo-width": 1.5 },
      });
      map.addLayer({
        id: "chome-names",
        type: "symbol",
        source: "boundary",
        minzoom: 15,
        layout: {
          "text-field": ["match", ["get", "name"], "神田神保町一丁目", "一丁目", "神田神保町二丁目", "二丁目", "神田神保町三丁目", "三丁目", ""],
          "text-font": ["Noto Sans CJK JP", "Yu Gothic", "Meiryo", "sans-serif"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 15, 16, 17, 14],
          "text-letter-spacing": 0.12,
          "text-padding": 14,
        },
        paint: {
          "text-color": "#717b72",
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.8, 17, 0.68, 18.5, 0],
          "text-halo-color": "#faf9f5",
          "text-halo-width": 1.2,
        },
      });

      // Apply any UI changes made while the asynchronous style was loading.
      syncLayers(map, visibleLayersRef.current);
      syncBuildingSelection(map, selectedBuildingIdRef.current);

      map.on("mousemove", (event) => {
        const building = map.queryRenderedFeatures(event.point, { layers: ["building-hit"] })[0];
        map.getCanvas().style.cursor = building ? "pointer" : "grab";
        map.setFilter("building-hover", ["==", ["get", "id"], getFeatureId(building) ?? ""]);
      });
      map.on("mouseleave", "building-hit", () => {
        map.getCanvas().style.cursor = "";
        map.setFilter("building-hover", ["==", ["get", "id"], ""]);
      });
      map.on("click", (event: MapMouseEvent) => {
        const building = map.queryRenderedFeatures(event.point, { layers: ["building-hit"] })[0];
        callbacksRef.current.onSelectBuilding(getFeatureId(building));
      });
    });

    return () => {
      map.remove();
      mapRef.current = undefined;
    };
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncLayers(map, visibleLayers);
  }, [visibleLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncBuildingSelection(map, selectedBuildingId);
  }, [selectedBuildingId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPlaceId) return;
    const feature = placeById.get(focusPlaceId);
    if (!feature) return;
    map.flyTo({ center: feature.geometry.coordinates as [number, number], zoom: 18.25, duration: 900, essential: true });
  }, [focusPlaceId, placeById]);

  return <div ref={containerRef} className="map-canvas" aria-label="神保町の建物を選んで店舗を調べる地図" />;
}
