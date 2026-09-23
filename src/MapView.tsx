import { useEffect, useMemo, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type {
  ExpressionSpecification,
  Map as MapLibreMap,
  MapMouseEvent,
  MapGeoJSONFeature,
} from "maplibre-gl";
import type { AtlasData, LayerKey, PlaceCategory } from "./types";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

type Props = {
  data: AtlasData;
  visibleLayers: Record<LayerKey, boolean>;
  selectedBuildingId?: string;
  selectedPlaceId?: string;
  focusPlaceId?: string;
  onSelectBuilding: (id?: string) => void;
  onSelectPlace: (id?: string) => void;
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

const PLACE_COLOR: ExpressionSpecification = [
  "match",
  ["get", "category"],
  "antiquarian_bookstore",
  "#8d3f2d",
  "bookstore",
  "#cd7540",
  "cafe",
  "#2f6f68",
  "restaurant",
  "#6c5287",
  "retail",
  "#617999",
  "culture",
  "#9a8128",
  "education",
  "#9a8128",
  "service",
  "#617999",
  "#69736f",
];

function getFeatureId(feature: MapGeoJSONFeature | undefined) {
  return String(feature?.properties?.id ?? "") || undefined;
}

function categoryLayer(category: PlaceCategory): LayerKey {
  switch (category) {
    case "antiquarian_bookstore":
    case "bookstore":
    case "cafe":
    case "restaurant":
      return category;
    default:
      return "other";
  }
}

function categoryFilter(property: "primaryUse" | "category", visibleLayers: Record<LayerKey, boolean>): ExpressionSpecification {
  const categories = (["antiquarian_bookstore", "bookstore", "cafe", "restaurant"] as const)
    .filter((category) => visibleLayers[category]);
  const enabled = visibleLayers.other
    ? [...categories, "retail", "culture", "education", "service", "other"]
    : categories;
  return enabled.length
    ? ["in", ["get", property], ["literal", enabled]]
    : ["==", ["get", property], "__none__"];
}

function syncCuratedLabels(map: MapLibreMap, visibleLayers: Record<LayerKey, boolean>) {
  const zoomedIn = map.getZoom() >= 17.2;
  map.getContainer().querySelectorAll<HTMLElement>(".curated-map-label").forEach((element) => {
    element.hidden = !zoomedIn || !visibleLayers[categoryLayer(element.dataset.category as PlaceCategory)];
  });
}

function syncLayers(map: MapLibreMap, visibleLayers: Record<LayerKey, boolean>) {
  if (!map.getLayer("buildings-fill")) return;
  const baseVisibility = visibleLayers.buildings ? "visible" : "none";
  map.setLayoutProperty("buildings-fill", "visibility", baseVisibility);
  map.setLayoutProperty("buildings-outline", "visibility", baseVisibility);
  const visibleCategories = categoryFilter("primaryUse", visibleLayers);
  map.setFilter("buildings-category", visibleCategories);
  map.setLayoutProperty("buildings-era", "visibility", visibleLayers.bookEra ? "visible" : "none");
  const eraBuildings: ExpressionSpecification = ["all", ["==", ["get", "hasBookstore"], true], ["!=", ["get", "bookstoreEra"], "unknown"]];
  map.setFilter(
    "building-hit",
    visibleLayers.buildings ? null : visibleLayers.bookEra ? ["any", visibleCategories, eraBuildings] : visibleCategories,
  );
  const alleyVisibility = visibleLayers.alleys ? "visible" : "none";
  map.setLayoutProperty("alleys-casing", "visibility", alleyVisibility);
  map.setLayoutProperty("alleys-line", "visibility", alleyVisibility);
  map.setFilter("places-points", categoryFilter("category", visibleLayers));
  syncCuratedLabels(map, visibleLayers);
}

function syncBuildingSelection(map: MapLibreMap, selectedBuildingId?: string) {
  if (!map.getLayer("building-selected") || !map.getLayer("building-selected-core")) return;
  const filter: ExpressionSpecification = ["==", ["get", "id"], selectedBuildingId ?? ""];
  map.setFilter("building-selected", filter);
  map.setFilter("building-selected-core", filter);
}

function syncPlaceSelection(map: MapLibreMap, selectedPlaceId?: string) {
  if (!map.getLayer("places-points")) return;
  map.setPaintProperty("places-points", "circle-stroke-color", [
    "case",
    ["==", ["get", "id"], selectedPlaceId ?? ""],
    "#17211f",
    "#fffdf7",
  ]);
  map.setPaintProperty("places-points", "circle-stroke-width", [
    "case",
    ["==", ["get", "id"], selectedPlaceId ?? ""],
    3,
    ["interpolate", ["linear"], ["zoom"], 15.7, 1, 18, 1.8],
  ]);
}

export default function MapView({
  data,
  visibleLayers,
  selectedBuildingId,
  selectedPlaceId,
  focusPlaceId,
  onSelectBuilding,
  onSelectPlace,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap>();
  const callbacksRef = useRef({ onSelectBuilding, onSelectPlace });
  const visibleLayersRef = useRef(visibleLayers);
  const selectedBuildingIdRef = useRef(selectedBuildingId);
  const selectedPlaceIdRef = useRef(selectedPlaceId);
  callbacksRef.current = { onSelectBuilding, onSelectPlace };
  visibleLayersRef.current = visibleLayers;
  selectedBuildingIdRef.current = selectedBuildingId;
  selectedPlaceIdRef.current = selectedPlaceId;

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
      minZoom: 14.3,
      maxZoom: 20,
      maxBounds: [
        [139.747, 35.689],
        [139.767, 35.7035],
      ],
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          gsi: {
            type: "raster",
            tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 18,
            attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>',
          },
        },
        layers: [{
          id: "gsi",
          type: "raster",
          source: "gsi",
          paint: {
            "raster-opacity": 0.14,
            "raster-saturation": -0.85,
            "raster-contrast": -0.18,
            "raster-brightness-min": 0.2,
          },
        }],
      },
    });

    const curatedMarkers: maplibregl.Marker[] = [];

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
      map.addSource("buildings", { type: "geojson", data: data.buildings, promoteId: "id" });
      map.addSource("places", { type: "geojson", data: data.places, promoteId: "id" });
      map.addSource("alleys", { type: "geojson", data: data.alleys });

      map.addLayer({
        id: "scope-mask",
        type: "fill",
        source: "boundary",
        paint: { "fill-color": "#f5f1e8", "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        minzoom: 14.3,
        paint: {
          "fill-color": "#d9d4c8",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14.3, 0.6, 17, 0.78, 20, 0.88],
        },
      });
      map.addLayer({
        id: "buildings-category",
        type: "fill",
        source: "buildings",
        minzoom: 14.3,
        filter: categoryFilter("primaryUse", visibleLayersRef.current),
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
          "line-color": "#625e55",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 14.3, 0.25, 18, 0.58],
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
        id: "places-points",
        type: "circle",
        source: "places",
        minzoom: 15.7,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 15.7, 2.5, 18, 5.2],
          "circle-color": PLACE_COLOR,
          "circle-stroke-color": "#fffdf7",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 15.7, 1, 18, 1.8],
          "circle-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "boundary-line",
        type: "line",
        source: "boundary",
        paint: { "line-color": "#97452f", "line-width": 1.3, "line-opacity": 0.7, "line-dasharray": [4, 2] },
      });

      data.places.features
        .filter((feature) => feature.properties.confidence === "confirmed")
        .forEach((feature) => {
          const element = document.createElement("button");
          element.type = "button";
          element.className = "curated-map-label";
          element.dataset.category = feature.properties.category;
          element.textContent = feature.properties.name;
          element.setAttribute("aria-label", `${feature.properties.name}を選択`);
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            callbacksRef.current.onSelectPlace(feature.properties.id);
            callbacksRef.current.onSelectBuilding(feature.properties.buildingId);
          });
          const marker = new maplibregl.Marker({ element, anchor: "left", offset: [7, 0] })
            .setLngLat(feature.geometry.coordinates as [number, number])
            .addTo(map);
          curatedMarkers.push(marker);
        });

      map.on("zoom", () => syncCuratedLabels(map, visibleLayersRef.current));

      // Apply any UI changes made while the asynchronous style was loading.
      syncLayers(map, visibleLayersRef.current);
      syncBuildingSelection(map, selectedBuildingIdRef.current);
      syncPlaceSelection(map, selectedPlaceIdRef.current);

      map.on("mousemove", (event) => {
        const hit = map.queryRenderedFeatures(event.point, { layers: ["places-points", "building-hit"] });
        const building = hit.find((feature) => feature.layer.id === "building-hit");
        map.getCanvas().style.cursor = hit.length ? "pointer" : "grab";
        map.setFilter("building-hover", ["==", ["get", "id"], getFeatureId(building) ?? ""]);
      });
      map.on("mouseleave", "building-hit", () => {
        map.getCanvas().style.cursor = "";
        map.setFilter("building-hover", ["==", ["get", "id"], ""]);
      });
      map.on("click", (event: MapMouseEvent) => {
        const hit = map.queryRenderedFeatures(event.point, { layers: ["places-points", "building-hit"] });
        const place = hit.find((feature) => feature.layer.id === "places-points");
        if (place) {
          callbacksRef.current.onSelectPlace(getFeatureId(place));
          const buildingId = String(place.properties?.buildingId ?? "");
          callbacksRef.current.onSelectBuilding(buildingId || undefined);
          return;
        }
        const building = hit.find((feature) => feature.layer.id === "building-hit");
        callbacksRef.current.onSelectPlace(undefined);
        callbacksRef.current.onSelectBuilding(getFeatureId(building));
      });
    });

    return () => {
      curatedMarkers.forEach((marker) => marker.remove());
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncPlaceSelection(map, selectedPlaceId);
  }, [selectedPlaceId]);

  return <div ref={containerRef} className="map-canvas" aria-label="神保町の建物と店舗の地図" />;
}
