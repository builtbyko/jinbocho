import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import { loadAtlasData } from "./data";
import { categoryLabel } from "./palette";
import type { AtlasData, BuildingFeature, LayerKey, PlaceFeature } from "./types";

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s・‐―ー-]/g, "");
}

function layerForCategory(category: string): LayerKey {
  if (category === "antiquarian_bookstore" || category === "bookstore" || category === "cafe" || category === "restaurant") {
    return category;
  }
  return "other";
}

function yearText(label: string, year?: number) {
  return year ? `${label} ${year}年` : undefined;
}

const initialLayers: Record<LayerKey, boolean> = {
  buildings: true,
  antiquarian_bookstore: true,
  bookstore: true,
  cafe: true,
  restaurant: true,
  other: false,
  bookEra: false,
  alleys: false,
};

function PlaceCard({ place, isSelected, onSelect }: { place: PlaceFeature; isSelected: boolean; onSelect: () => void }) {
  const p = place.properties;
  return (
    <button className={`place-card ${isSelected ? "is-selected" : ""}`} type="button" onClick={onSelect}>
      <span className={`category-dot category-${p.category}`} />
      <span className="place-card-copy">
        <strong>{p.name}</strong>
        <small>
          {categoryLabel[p.category]}
          {p.floor ? ` · ${p.floor}` : ""}
          {p.foundedYear ? ` · 創業${p.foundedYear}年` : ""}
        </small>
      </span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

function DetailPanel({
  building,
  places,
  selectedPlace,
  onSelectPlace,
  onClose,
}: {
  building?: BuildingFeature;
  places: PlaceFeature[];
  selectedPlace?: PlaceFeature;
  onSelectPlace: (id: string) => void;
  onClose: () => void;
}) {
  if (!building && !selectedPlace) return null;
  const activePlace = selectedPlace ?? (places.length === 1 ? places[0] : undefined);
  return (
    <aside className="detail-panel" aria-label="選択した建物の詳細">
      <div className="detail-head">
        <div>
          <span className="eyebrow">店舗・建物</span>
          <h2>{activePlace?.properties.name ?? building?.properties.name ?? "建物"}</h2>
          <p>{activePlace ? categoryLabel[activePlace.properties.category] : `${places.length}件の場所情報`}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="詳細を閉じる">×</button>
      </div>

      {activePlace ? (
        <div className="detail-body">
          <div className="badges">
            <span>{categoryLabel[activePlace.properties.category]}</span>
            <span className={activePlace.properties.confidence === "confirmed" ? "badge-confirmed" : ""}>
              {activePlace.properties.confidence === "confirmed" ? "公式情報確認" : "OSM参考"}
            </span>
          </div>
          {activePlace.properties.specialty && <p className="lead">{activePlace.properties.specialty}</p>}
          <dl className="fact-list">
            {yearText("創業", activePlace.properties.foundedYear) && <><dt>店の歴史</dt><dd>{yearText("創業", activePlace.properties.foundedYear)}</dd></>}
            {yearText("神保町で開業", activePlace.properties.jinbochoOpenedYear) && <><dt>神保町</dt><dd>{yearText("開業", activePlace.properties.jinbochoOpenedYear)}</dd></>}
            {yearText("現在地へ移転", activePlace.properties.currentLocationSince) && <><dt>現在地</dt><dd>{yearText("移転", activePlace.properties.currentLocationSince)}</dd></>}
            {activePlace.properties.floor && <><dt>階</dt><dd>{activePlace.properties.floor}</dd></>}
            {activePlace.properties.address && <><dt>住所</dt><dd>{activePlace.properties.address}</dd></>}
            {activePlace.properties.hours && <><dt>営業時間</dt><dd>{activePlace.properties.hours}</dd></>}
            {activePlace.properties.notableReason && <><dt>掲載根拠</dt><dd>{activePlace.properties.notableReason}</dd></>}
          </dl>
          {activePlace.properties.note && <p className="detail-note">{activePlace.properties.note}</p>}
          <div className="source-box">
            <span>出典 · {activePlace.properties.observedAt}確認</span>
            <a href={activePlace.properties.sourceUrl} target="_blank" rel="noreferrer">{activePlace.properties.sourceLabel} ↗</a>
            {activePlace.properties.website && activePlace.properties.website !== activePlace.properties.sourceUrl && (
              <a href={activePlace.properties.website} target="_blank" rel="noreferrer">店舗サイト ↗</a>
            )}
          </div>
        </div>
      ) : (
        <div className="detail-body">
          <p className="lead">{places.length ? "この建物の店舗を選んでください。" : "この建物の店舗情報はまだありません。"}</p>
        </div>
      )}

      {places.length > 1 && (
        <div className="building-places">
          <span className="eyebrow">この建物の店舗 · {places.length}</span>
          {places.map((place) => (
            <PlaceCard
              key={place.properties.id}
              place={place}
              isSelected={place.properties.id === activePlace?.properties.id}
              onSelect={() => onSelectPlace(place.properties.id)}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function AboutPanel({ data, onClose }: { data: AtlasData; onClose: () => void }) {
  const buildingMetadata = data.buildings.features[0]?.properties;
  const usesTokyoBuildings = buildingMetadata?.source.includes("東京都");

  return (
    <aside className="about-panel" aria-label="この地図について">
      <div className="detail-head">
        <div>
          <span className="eyebrow">データについて</span>
          <h2>この地図について</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="説明を閉じる">×</button>
      </div>
      <div className="about-body">
        <p className="lead">神田神保町一〜三丁目の建物と店舗を表示しています。左の一覧で見たいレイヤーを選び、地図上の店を押すと詳細が開きます。</p>
        <h3>データの注意点</h3>
        <ul>{data.summary.caveats.map((item) => <li key={item}>{item}</li>)}</ul>
        <div className="source-box">
          <span>基礎データ</span>
          {usesTokyoBuildings ? (
            <a href="https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000019" target="_blank" rel="noreferrer">
              建物現況GIS · 東京都（{buildingMetadata.observedAt}）↗
            </a>
          ) : (
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              建物ポリゴン · OpenStreetMap（{buildingMetadata?.observedAt ?? "観測日不明"}）↗
            </a>
          )}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            店舗・路地 · OpenStreetMap（{data.summary.osmObservedAt}観測）↗
          </a>
          <a href="https://geoshape.ex.nii.ac.jp/ka/" target="_blank" rel="noreferrer">町丁目境界 · CODH ↗</a>
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  const [data, setData] = useState<AtlasData>();
  const [error, setError] = useState<string>();
  const [visibleLayers, setVisibleLayers] = useState<Record<LayerKey, boolean>>(initialLayers);
  const [query, setQuery] = useState("");
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>();
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>();
  const [focusPlaceId, setFocusPlaceId] = useState<string>();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    loadAtlasData().then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "データを読み込めませんでした"));
  }, []);

  const buildingById = useMemo(
    () => new Map(data?.buildings.features.map((feature) => [feature.properties.id, feature]) ?? []),
    [data],
  );
  const placeById = useMemo(
    () => new Map(data?.places.features.map((feature) => [feature.properties.id, feature]) ?? []),
    [data],
  );
  const placesByBuilding = useMemo(() => {
    const grouped = new Map<string, PlaceFeature[]>();
    data?.places.features.forEach((feature) => {
      const id = feature.properties.buildingId;
      if (!id) return;
      grouped.set(id, [...(grouped.get(id) ?? []), feature]);
    });
    return grouped;
  }, [data]);

  const results = useMemo(() => {
    if (!data || normalize(query).length < 1) return [];
    const needle = normalize(query);
    return data.places.features
      .filter(({ properties: p }) => normalize([p.name, ...(p.aliases ?? []), p.specialty ?? "", p.address ?? ""].join(" ")).includes(needle))
      .sort((a, b) => Number(b.properties.confidence === "confirmed") - Number(a.properties.confidence === "confirmed"))
      .slice(0, 8);
  }, [data, query]);

  const selectPlace = (id?: string) => {
    setSelectedPlaceId(id);
    if (!id) return;
    const place = placeById.get(id);
    if (place) {
      const layer = layerForCategory(place.properties.category);
      setVisibleLayers((current) => ({ ...current, [layer]: true }));
    }
    setSelectedBuildingId(place?.properties.buildingId);
    setFocusPlaceId(undefined);
    requestAnimationFrame(() => setFocusPlaceId(id));
    setQuery("");
    setSidebarOpen(false);
  };

  const selectedBuilding = selectedBuildingId ? buildingById.get(selectedBuildingId) : undefined;
  const selectedPlace = selectedPlaceId ? placeById.get(selectedPlaceId) : undefined;
  const buildingPlaces = selectedBuildingId ? placesByBuilding.get(selectedBuildingId) ?? [] : selectedPlace ? [selectedPlace] : [];

  if (error) {
    return <main className="state-screen"><strong>地図を開けませんでした</strong><p>{error}</p></main>;
  }
  if (!data) {
    return <main className="state-screen"><span className="loader" /><strong>神保町の街を読み込んでいます</strong></main>;
  }

  const countCategory = (category: string) =>
    data.places.features.filter((place) => place.properties.category === category).length;
  const otherCount = data.places.features.filter(
    (place) => layerForCategory(place.properties.category) === "other",
  ).length;
  const layers: { id: LayerKey; name: string; color: string; count: number; line?: boolean }[] = [
    { id: "buildings", name: "建物", color: "#d9d4c8", count: data.summary.buildingCount },
    { id: "antiquarian_bookstore", name: "古書店", color: "#a6533c", count: countCategory("antiquarian_bookstore") },
    { id: "bookstore", name: "新刊・専門書店", color: "#d98a4e", count: countCategory("bookstore") },
    { id: "cafe", name: "喫茶・カフェ", color: "#4f7f78", count: data.summary.cafeCount },
    { id: "restaurant", name: "飲食店", color: "#7f6b9f", count: data.summary.restaurantCount },
    { id: "other", name: "その他の店・施設", color: "#7389a6", count: otherCount },
    { id: "bookEra", name: "書店の創業年代", color: "#6c3328", count: data.summary.bookstoreEraCount },
    { id: "alleys", name: "路地・細街路", color: "#495753", count: data.summary.alleyCount, line: true },
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <h1>神保町マップ</h1>
          <span className="brand-jp">店と建物</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="text-button" onClick={() => setAboutOpen(true)}>データについて</button>
          <button type="button" className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="レイヤーを開く">レイヤー</button>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
          <div className="sidebar-mobile-head">
            <strong>レイヤー</strong>
            <button type="button" className="icon-button" onClick={() => setSidebarOpen(false)} aria-label="レイヤーを閉じる">×</button>
          </div>
          <div className="search-block">
            <label htmlFor="place-search">店を探す</label>
            <div className="search-input-wrap">
              <span aria-hidden="true">⌕</span>
              <input id="place-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="店名・専門分野・住所" autoComplete="off" />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="検索を消去">×</button>}
            </div>
            {query && (
              <div className="search-results">
                {results.length ? results.map((place) => (
                  <PlaceCard key={place.properties.id} place={place} isSelected={false} onSelect={() => selectPlace(place.properties.id)} />
                )) : <p>一致する場所がありません</p>}
              </div>
            )}
          </div>

          <section className="control-section">
            <h2>レイヤー</h2>
            <div className="layer-list">
              {layers.map((layer) => (
                <label className="layer-row" key={layer.id}>
                  <input
                    type="checkbox"
                    checked={visibleLayers[layer.id]}
                    onChange={() => setVisibleLayers((current) => ({ ...current, [layer.id]: !current[layer.id] }))}
                  />
                  <span
                    className={layer.line ? "layer-swatch is-line" : layer.id === "bookEra" ? "layer-swatch is-era" : "layer-swatch"}
                    style={{ backgroundColor: layer.line || layer.id === "bookEra" ? undefined : layer.color, borderColor: layer.color }}
                    aria-hidden="true"
                  />
                  <span className="layer-name">{layer.name}</span>
                  <span className="layer-count">{layer.count}</span>
                </label>
              ))}
            </div>
            <p className="layer-note">数字は件数（店は店舗数）。建物は代表用途の色、点は店の位置です。</p>
            {visibleLayers.bookEra && <p className="layer-note">創業年代は色が濃いほど古い店です。確認できた店のみ表示します。</p>}
          </section>
        </aside>

        <section className="map-wrap">
          <MapView
            data={data}
            visibleLayers={visibleLayers}
            selectedBuildingId={selectedBuildingId}
            selectedPlaceId={selectedPlaceId}
            focusPlaceId={focusPlaceId}
            onSelectBuilding={(id) => { setSelectedBuildingId(id); if (!id) setSelectedPlaceId(undefined); }}
            onSelectPlace={selectPlace}
          />
          <DetailPanel
            building={selectedBuilding}
            places={buildingPlaces}
            selectedPlace={selectedPlace}
            onSelectPlace={(id) => selectPlace(id)}
            onClose={() => { setSelectedBuildingId(undefined); setSelectedPlaceId(undefined); }}
          />
          {aboutOpen && <AboutPanel data={data} onClose={() => setAboutOpen(false)} />}
        </section>
      </div>
      {sidebarOpen && <button className="scrim" type="button" onClick={() => setSidebarOpen(false)} aria-label="メニューを閉じる" />}
    </main>
  );
}
