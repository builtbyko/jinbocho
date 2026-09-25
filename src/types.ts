import type { Feature, FeatureCollection, Geometry, MultiPolygon, Point, Polygon } from "geojson";

export type LayerKey =
  | "buildings"
  | "antiquarian_bookstore"
  | "bookstore"
  | "cafe"
  | "restaurant"
  | "other"
  | "bookEra"
  | "alleys";

export type PlaceCategory =
  | "antiquarian_bookstore"
  | "bookstore"
  | "cafe"
  | "restaurant"
  | "retail"
  | "culture"
  | "education"
  | "service"
  | "other";

export type BuildingProperties = {
  id: string;
  sourceId: string;
  floors?: number | string;
  areaSqm?: number;
  name?: string;
  address?: string;
  primaryUse: string;
  primaryUseBasis: "confirmed_ground_floor" | "floor_unverified" | "upper_or_basement_only" | "no_place";
  placeCount: number;
  placeIds: string[];
  placeNames: string[];
  hasBookstore: boolean;
  hasCafe: boolean;
  hasRestaurant: boolean;
  bookstoreEra: string;
  oldestBookstoreYear?: number;
  mixedUse: boolean;
  source: string;
  observedAt: string;
};

export type PlaceProperties = {
  id: string;
  osmId?: number;
  buildingId?: string;
  name: string;
  aliases?: string[];
  category: PlaceCategory;
  subcategory?: string;
  specialty?: string;
  description?: string;
  descriptionSourceUrl?: string;
  descriptionSourceLabel?: string;
  floor?: string;
  address?: string;
  foundedYear?: number;
  jinbochoOpenedYear?: number;
  currentLocationSince?: number;
  era: string;
  hours?: string;
  website?: string;
  note?: string;
  notableReason?: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceType: "official" | "association" | "open_data" | "editorial";
  observedAt: string;
  confidence: "confirmed" | "reference";
};

export type SummaryData = {
  generatedAt: string;
  osmObservedAt: string;
  scope: string;
  buildingCount: number;
  placeCount: number;
  bookstoreCount: number;
  bookstoreEraCount: number;
  cafeCount: number;
  restaurantCount: number;
  alleyCount: number;
  curatedPlaceCount: number;
  caveats: string[];
};

export type AtlasData = {
  boundary: FeatureCollection<Geometry>;
  basemapRoads: FeatureCollection<Geometry>;
  basemapSidewalks: FeatureCollection<Geometry>;
  basemapRoadNames: FeatureCollection<Geometry>;
  buildings: FeatureCollection<Polygon | MultiPolygon, BuildingProperties>;
  places: FeatureCollection<Point, PlaceProperties>;
  alleys: FeatureCollection<Geometry>;
  summary: SummaryData;
};

export type BuildingFeature = Feature<Polygon | MultiPolygon, BuildingProperties>;
export type PlaceFeature = Feature<Point, PlaceProperties>;
