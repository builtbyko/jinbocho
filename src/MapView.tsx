import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type {
  ExpressionSpecification,
  Map as MapLibreMap,
  MapMouseEvent,
  MapGeoJSONFeature,
  GeoJSONSource,
} from "maplibre-gl";
import type { AtlasData, LayerKey } from "./types";
import { buildingLabelData } from "./mapLabels";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

type Props = {
  data: AtlasData;
  visibleLayers: Record<LayerKey, boolean>;
  selectedBuildingId?: string;
  focusPlaceId?: string;
  onSelectBuilding: (id?: string) => void;
  onSelectPlace: (id: string) => void;
  onOverview: () => void;
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
  "match",
  ["get", "antiquarianEra"],
  "prewar",
  "#6c3328",
  "1945-1969",
  "#9e5540",
  "1970-1999",
  "#c67b55",
  "2000-present",
  "#e3aa75",
  "#c9c4b8",
];

function oldestAntiquarianEras(data: AtlasData) {
  const eras = new Map<string, { year: number; era: string }>();
  for (const { properties: place } of data.places.features) {
    if (place.category !== "antiquarian_bookstore" || !place.buildingId || !place.foundedYear || place.era === "unknown") continue;
    const current = eras.get(place.buildingId);
    if (!current || place.foundedYear < current.year) {
      eras.set(place.buildingId, { year: place.foundedYear, era: place.era });
    }
  }
  return eras;
}

function antiquarianEraBuildings(data: AtlasData) {
  const eras = oldestAntiquarianEras(data);
  return {
    type: "FeatureCollection" as const,
    features: data.buildings.features.flatMap((building) => {
      const age = eras.get(building.properties.id);
      return age ? [{ ...building, properties: { ...building.properties, antiquarianEra: age.era } }] : [];
    }),
  };
}

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

function syncLayers(map: MapLibreMap, visibleLayers: Record<LayerKey, boolean>, data: AtlasData) {
  if (!map.getLayer("buildings-fill")) return;
  const baseVisibility = visibleLayers.buildings ? "visible" : "none";
  map.setLayoutProperty("buildings-fill", "visibility", baseVisibility);
  map.setLayoutProperty("buildings-outline", "visibility", baseVisibility);
  const visibleCategories = categoryFilter(visibleLayers);
  map.setFilter("buildings-category", visibleCategories);
  map.setLayoutProperty("buildings-era", "visibility", visibleLayers.bookEra ? "visible" : "none");
  const eraBuildingIds = [...oldestAntiquarianEras(data).keys()];
  const eraBuildings: ExpressionSpecification = eraBuildingIds.length
    ? ["in", ["get", "id"], ["literal", eraBuildingIds]]
    : ["==", ["get", "id"], "__none__"];
  map.setFilter(
    "building-hit",
    visibleLayers.buildings
      ? [">", ["get", "placeCount"], 0]
      : visibleLayers.bookEra
        ? ["any", visibleCategories, eraBuildings]
        : visibleCategories,
  );
  if (map.getLayer("history-markers")) {
    for (const id of ["history-hit","history-markers","history-symbols"]) map.setFilter(id, visibleCategories);
    const enabledIds = data.places.features.filter(({properties:p}) => {
      const layer = ["antiquarian_bookstore","bookstore","cafe","restaurant"].includes(p.category) ? p.category as LayerKey : "other";
      return p.bookwalkImported && p.buildingId && visibleLayers[layer];
    }).map(f=>f.properties.buildingId!);
    map.setFilter("history-buildings",["in",["get","id"],["literal",enabledIds]]);
  }
  for (const id of ["district-plan-fill","district-plan-line"]) map.setLayoutProperty(id,"visibility",visibleLayers.districtPlan ? "visible" : "none");
  map.setLayoutProperty("road-classification","visibility",visibleLayers.roadTypes ? "visible" : "none");
  map.setLayoutProperty("road-names","text-field",["case",["==",["get","roadKind"],"metropolitan"],["format",["get","name"],{}," ",{},["image",["get","routeIcon"]],{}],["get","displayName"]]);
  const alleyVisibility = visibleLayers.alleys ? "visible" : "none";
  map.setLayoutProperty("alleys-casing", "visibility", alleyVisibility);
  map.setLayoutProperty("alleys-line", "visibility", alleyVisibility);
  (map.getSource("shop-names") as GeoJSONSource).setData(buildingLabelData(data, visibleLayers));
  if (map.getLayer("standalone-places")) {
    map.setFilter("standalone-places", visibleCategories);
    map.setFilter("standalone-labels", visibleCategories);
  }
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
  onSelectPlace,
  onOverview,
}: Props) {
  const [locationStatus, setLocationStatus] = useState("");
  const [locating, setLocating] = useState(false);
  const watchRef = useRef<number>();
  const markerRef = useRef<maplibregl.Marker>();
  const followRef = useRef(false);
  const readyRef = useRef(false);
  const firstFixRef = useRef(true);
  const overview = () => {
    followRef.current = false;
    onOverview();
    const bounds = new maplibregl.LngLatBounds();
    data.places.features.filter(f => f.properties.bookwalkImported).forEach(f => bounds.extend(f.geometry.coordinates as [number, number]));
    mapRef.current?.fitBounds(bounds, {
      padding: {top:105,bottom:70,left:35,right:55}, maxZoom:16.35,
      duration:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500,
    });
  };
  const locate = () => {
    if (watchRef.current !== undefined) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = undefined;
      followRef.current = false;
      setLocating(false);
      markerRef.current?.remove(); markerRef.current=undefined;
      (mapRef.current?.getSource("location-accuracy") as GeoJSONSource | undefined)?.setData({type:"FeatureCollection",features:[]});
      setLocationStatus("現在地の更新を停止しました");
      return;
    }
    if (!navigator.geolocation || !window.isSecureContext) {
      setLocationStatus("この環境では現在地を利用できません"); return;
    }
    if (!readyRef.current) { setLocationStatus("地図を読み込んでいます。少し待ってから押してください"); return; }
    followRef.current = true;
    firstFixRef.current = true;
    onOverview();
    setLocating(true);
    setLocationStatus("現在地を取得中。位置情報の利用を許可してください");
    watchRef.current = navigator.geolocation.watchPosition(position => {
      const map = mapRef.current;
      if (!map) return;
      const {longitude:lng, latitude:lat, accuracy} = position.coords;
      if (!markerRef.current) {
        const dot=document.createElement("div"); dot.className="user-location-dot";
        markerRef.current = new maplibregl.Marker({element:dot}).setLngLat([lng,lat]).addTo(map);
      }
      else markerRef.current.setLngLat([lng,lat]);
      markerRef.current.getElement().setAttribute("aria-label", "現在地");
      const ring = Array.from({length:65},(_,i) => {
        const a=i*Math.PI/32;
        return [lng+Math.cos(a)*accuracy/(111320*Math.cos(lat*Math.PI/180)),lat+Math.sin(a)*accuracy/111320];
      });
      (map.getSource("location-accuracy") as GeoJSONSource).setData({type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[ring]}});
      if (followRef.current) map.easeTo({center:[lng,lat],...(firstFixRef.current ? {zoom:17.5} : {}),padding:{top:0,bottom:0,left:0,right:0},duration:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500});
      firstFixRef.current = false;
      const outside=lng<139.747||lng>139.767||lat<35.689||lat>35.7035;
      setLocationStatus(`現在地を表示中 · 精度 約${Math.round(accuracy)}m。${outside ? "神保町の外です。「全体」で地図に戻れます" : "地図を動かすと追従を止めます"}`);
    },error => {
      if (watchRef.current !== undefined) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current=undefined; setLocating(false); followRef.current=false;
      markerRef.current?.remove(); markerRef.current=undefined;
      (mapRef.current?.getSource("location-accuracy") as GeoJSONSource | undefined)?.setData({type:"FeatureCollection",features:[]});
      setLocationStatus(error.code===1 ? "位置情報が許可されていません。ブラウザのサイト設定で許可してください" : error.code===3 ? "取得に時間がかかっています。屋外で再度お試しください" : "現在地を取得できません。端末の位置情報設定を確認してください");
    },{enableHighAccuracy:true,timeout:20000,maximumAge:10000});
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap>();
  const callbacksRef = useRef({ onSelectBuilding, onSelectPlace });
  const visibleLayersRef = useRef(visibleLayers);
  const selectedBuildingIdRef = useRef(selectedBuildingId);
  callbacksRef.current = { onSelectBuilding, onSelectPlace };
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
      minZoom: 2,
      maxZoom: 20,
      attributionControl: false,
      locale: { "GeolocateControl.FindMyLocation": "現在地を表示", "GeolocateControl.TrackLocation": "現在地を追従", "GeolocateControl.LocationNotAvailable": "現在地を取得できません" },
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

    map.on("dragstart", () => { followRef.current = false; });
    map.on("load", () => {
      readyRef.current = true;
      map.addSource("outside-context", {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 18,
        attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>',
      });
      map.addLayer({
        id: "outside-context",
        type: "raster",
        source: "outside-context",
        paint: { "raster-opacity": 0.58, "raster-saturation": -0.72 },
      });
      for (const number of ["301","302"]) {
        const canvas=document.createElement("canvas");canvas.width=72;canvas.height=72;
        const ctx=canvas.getContext("2d")!;
        ctx.beginPath();ctx.moveTo(18,5);ctx.lineTo(54,5);ctx.lineTo(69,36);ctx.lineTo(54,67);ctx.lineTo(18,67);ctx.lineTo(3,36);ctx.closePath();ctx.fillStyle="#235aab";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=3;ctx.stroke();
        ctx.fillStyle="#fff";ctx.font="bold 26px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(number,36,37);
        map.addImage(`route-${number}`,ctx.getImageData(0,0,72,72),{pixelRatio:4});
      }
      map.addSource("planning-areas",{type:"geojson",data:data.planningAreas});
      map.addSource("road-classification",{type:"geojson",data:data.roadClassification});
      map.addSource("boundary", { type: "geojson", data: data.boundary });
      map.addSource("basemap-roads", { type: "geojson", data: data.basemapRoads });
      map.addSource("basemap-sidewalks", { type: "geojson", data: data.basemapSidewalks });
      map.addSource("basemap-road-names", { type: "geojson", data: data.basemapRoadNames });
      map.addSource("buildings", { type: "geojson", data: data.buildings, promoteId: "id" });
      map.addSource("antiquarian-eras", { type: "geojson", data: antiquarianEraBuildings(data) });
      map.addSource("alleys", { type: "geojson", data: data.alleys });
      map.addSource("shop-names", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("standalone-places", { type: "geojson", data: {
        type: "FeatureCollection",
        features: data.places.features.filter(f => f.properties.bookwalkImported && !f.properties.buildingId)
          .map(f => ({...f, properties: {...f.properties, primaryUse: f.properties.category}})),
      } });

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
      map.addLayer({id:"road-classification",type:"line",source:"road-classification",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":["match",["get","roadKind"],"metropolitan","#b78a2e","ward","#4480ab","national","#b75650","private","#8c6f98","#929894"],"line-width":["interpolate",["linear"],["zoom"],15,.9,18,2.2],"line-opacity":.65}});
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
        source: "antiquarian-eras",
        minzoom: 14.3,
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
      map.addLayer({id:"district-plan-fill",type:"fill",source:"planning-areas",filter:["==",["get","kind"],"district_plan"],layout:{visibility:"none"},paint:{"fill-color":"#79609a","fill-opacity":.055}});
      map.addLayer({id:"district-plan-line",type:"line",source:"planning-areas",filter:["==",["get","kind"],"district_plan"],layout:{visibility:"none"},paint:{"line-color":"#79609a","line-width":1.7,"line-dasharray":[5,2]}});
      map.addLayer({id:"regeneration-line",type:"line",source:"planning-areas",filter:["==",["get","kind"],"regeneration"],layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#bf4242","line-width":1.2,"line-dasharray":[1,3],"line-opacity":.95}});
      // Later symbol layers are placed first: confirmed shops precede general shops,
      // while the street labels below retain priority over both.
      for (const [id, confirmed, minzoom] of [
        ["shop-names", false, 19.2],
        ["shop-names-confirmed", true, 17.8],
      ] as const) {
        map.addLayer({
          id,
          type: "symbol",
          source: "shop-names",
          minzoom,
          filter: ["==", ["get", "confirmed"], confirmed],
          layout: {
            "symbol-placement": "point",
            "symbol-sort-key": ["get", "priority"],
            "text-field": ["format", ["get", "name"], {}, ["get", "otherShops"], { "font-scale": 0.8 }],
            "text-font": ["Noto Sans CJK JP", "Yu Gothic", "Meiryo", "sans-serif"],
            "text-size": confirmed
              ? ["interpolate", ["linear"], ["zoom"], 17.8, 12.5, 20, 15]
              : ["interpolate", ["linear"], ["zoom"], 19.2, 11, 20, 13],
            "text-max-width": 11,
            "text-line-height": 1.25,
            "text-padding": 7,
            "text-allow-overlap": false,
            "text-ignore-placement": false,
          },
          paint: { "text-color": "#26352f", "text-halo-color": "#fffefa", "text-halo-width": 1.4 },
        });
      }
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

      map.addSource("history-places", {type:"geojson",data:{type:"FeatureCollection",features:data.places.features.filter(f=>f.properties.bookwalkImported).map(f=>({...f,properties:{...f.properties,primaryUse:f.properties.category}}))}});
      const historyIds=data.places.features.filter(f=>f.properties.bookwalkImported && f.properties.buildingId).map(f=>f.properties.buildingId!);
      map.addLayer({id:"history-buildings",type:"line",source:"buildings",filter:["in",["get","id"],["literal",historyIds]],paint:{"line-color":"#244e47","line-width":2.5,"line-opacity":.95}});
      map.addLayer({id:"history-hit",type:"circle",source:"history-places",paint:{"circle-radius":19,"circle-opacity":0}});
      map.addLayer({id:"history-markers",type:"circle",source:"history-places",paint:{"circle-radius":10,"circle-color":"#244e47","circle-stroke-color":"#fffdf8","circle-stroke-width":2}});
      map.addLayer({id:"history-symbols",type:"symbol",source:"history-places",layout:{"text-field":"i","text-font":["Noto Sans CJK JP","sans-serif"],"text-size":14,"text-allow-overlap":true,"text-ignore-placement":true},paint:{"text-color":"#fff"}});
      map.addSource("location-accuracy",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
      map.addLayer({id:"location-accuracy",type:"fill",source:"location-accuracy",paint:{"fill-color":"#3979d6","fill-opacity":.12}});
      map.addLayer({id:"location-accuracy-edge",type:"line",source:"location-accuracy",paint:{"line-color":"#3979d6","line-opacity":.5,"line-width":1}});
      // Curated sites outside the footprint coverage remain directly selectable.
      map.addLayer({id:"standalone-places",type:"circle",source:"standalone-places",paint:{
        "circle-radius":7,"circle-color":"#b29a45","circle-stroke-color":"#fff","circle-stroke-width":2,
      }});
      map.addLayer({id:"standalone-labels",type:"symbol",source:"standalone-places",layout:{
        "text-field":["get","name"],"text-font":["Noto Sans CJK JP","Yu Gothic","Meiryo","sans-serif"],
        "text-size":12,"text-anchor":"left","text-offset":[1,0],"text-max-width":12,
      },paint:{"text-color":"#26352f","text-halo-color":"#fffefa","text-halo-width":1.5}});

      // Keep the same explanation marker above standalone site symbols too.
      for (const id of ["history-hit", "history-markers", "history-symbols"]) map.moveLayer(id);

      // Apply any UI changes made while the asynchronous style was loading.
      syncLayers(map, visibleLayersRef.current, data);
      syncBuildingSelection(map, selectedBuildingIdRef.current);

      map.on("mousemove", (event) => {
        const building = map.queryRenderedFeatures(event.point, { layers: ["history-hit", "standalone-places", "standalone-labels", "shop-names-confirmed", "shop-names", "building-hit"] })[0];
        map.getCanvas().style.cursor = building ? "pointer" : "grab";
        map.setFilter("building-hover", ["==", ["get", "id"], getFeatureId(building) ?? ""]);
      });
      map.on("mouseout", () => {
        map.getCanvas().style.cursor = "";
        map.setFilter("building-hover", ["==", ["get", "id"], ""]);
      });
      map.on("click", (event: MapMouseEvent) => {
        const building = map.queryRenderedFeatures(event.point, { layers: ["history-hit", "standalone-places", "standalone-labels", "shop-names-confirmed", "shop-names", "building-hit"] })[0];
        if (building?.layer.id === "history-hit" || building?.layer.id.startsWith("standalone-")) {
          const id = getFeatureId(building);
          if (id) callbacksRef.current.onSelectPlace(id);
          return;
        }
        callbacksRef.current.onSelectBuilding(getFeatureId(building));
      });
    });

    return () => {
      if (watchRef.current !== undefined) navigator.geolocation.clearWatch(watchRef.current);
      markerRef.current?.remove();
      readyRef.current = false;
      map.remove();
      mapRef.current = undefined;
    };
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncLayers(map, visibleLayers, data);
  }, [visibleLayers, data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncBuildingSelection(map, selectedBuildingId);
  }, [selectedBuildingId]);

  useEffect(() => {
    const map=mapRef.current;
    if (!map || !visibleLayers.districtPlan) return;
    followRef.current=false;
    const feature=data.planningAreas.features.find(f=>f.properties?.kind==="district_plan");
    if (!feature) return;
    const bounds=new maplibregl.LngLatBounds();
    const walk=(coordinates: unknown):void => {
      if (!Array.isArray(coordinates)) return;
      if (typeof coordinates[0]==="number") bounds.extend(coordinates as [number,number]);
      else coordinates.forEach(walk);
    };
    if ("coordinates" in feature.geometry) walk(feature.geometry.coordinates);
    map.fitBounds(bounds,{padding:{top:100,bottom:65,left:35,right:55},duration:500});
  },[visibleLayers.districtPlan,data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPlaceId) return;
    const feature = placeById.get(focusPlaceId);
    if (!feature) return;
    followRef.current = false;
    const mobile = window.innerWidth <= 960;
    const padding = mobile
      ? { top: 50, bottom: Math.round(map.getContainer().clientHeight * .50), left: 20, right: 20 }
      : { top: 30, bottom: 30, left: 30, right: 400 };
    map.flyTo({ center: feature.geometry.coordinates as [number, number], zoom: 18.25, padding,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700 });
  }, [focusPlaceId, placeById]);

  return <>
    <div ref={containerRef} className="map-canvas" aria-label="神保町の建物を選んで店舗を調べる地図" />
    <div className="walking-controls">
      <button type="button" onClick={locate} aria-pressed={locating}>◎ {locating ? "現在地を停止" : "現在地"}</button>
      <button type="button" onClick={overview}>全体</button>
    </div>
    <p className="history-map-key"><span aria-hidden="true">i</span> 解説のある場所</p>
    {locationStatus && <div className="location-status" role="status"><span>{locationStatus}</span><button type="button" aria-label="現在地の案内を閉じる" onClick={()=>setLocationStatus("")}>×</button></div>}
  </>;
}
