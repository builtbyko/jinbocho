import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import { loadAtlasData } from "./data";
import { categoryLabel, eraLabel, eraLegend, themeLabels, useLegend } from "./palette";
import type { AtlasData, BuildingFeature, PlaceFeature, ThemeKey } from "./types";

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s・‐―ー-]/g, "");
}

function yearText(label: string, year?: number) {
  return year ? `${label} ${year}年` : undefined;
}

const primaryUseBasisLabel: Record<BuildingFeature["properties"]["primaryUseBasis"], string> = {
  confirmed_ground_floor: "建物色：地上階確認",
  floor_unverified: "建物色：階未確認",
  upper_or_basement_only: "建物色：非地上階のみ",
  no_place: "建物色：店舗情報なし",
};

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <strong>{value.toLocaleString("ja-JP")}</strong>
      <span>{label}</span>
    </div>
  );
}

function Toggle({ checked, onChange, label, note }: { checked: boolean; onChange: () => void; label: string; note: string }) {
  return (
    <button type="button" className={`toggle ${checked ? "is-active" : ""}`} onClick={onChange} aria-pressed={checked}>
      <span className="toggle-check" aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{note}</small>
      </span>
    </button>
  );
}

function Legend({ theme }: { theme: ThemeKey }) {
  const items = theme === "bookEra" ? eraLegend : theme === "food" ? useLegend.filter(([key]) => key === "cafe" || key === "restaurant" || key === "unclassified") : useLegend;
  return (
    <div className="legend" aria-label="凡例">
      <span className="eyebrow">LEGEND</span>
      <div className="legend-grid">
        {items.map(([key, label, color]) => (
          <span className="legend-item" key={key}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
        {theme === "alleys" && (
          <span className="legend-item">
            <i className="line-swatch" />路地・細街路
          </span>
        )}
      </div>
    </div>
  );
}

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
          <span className="eyebrow">BUILDING / PLACE</span>
          <h2>{activePlace?.properties.name ?? building?.properties.name ?? "建物"}</h2>
          <p>{activePlace ? categoryLabel[activePlace.properties.category] : `${places.length}件の場所情報`}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="詳細を閉じる">×</button>
      </div>

      {activePlace ? (
        <div className="detail-body">
          <div className="badges">
            <span>{categoryLabel[activePlace.properties.category]}</span>
            {building && <span>{primaryUseBasisLabel[building.properties.primaryUseBasis]}</span>}
            <span className={activePlace.properties.confidence === "confirmed" ? "badge-confirmed" : ""}>
              {activePlace.properties.confidence === "confirmed" ? "公式情報確認" : "OSM参考"}
            </span>
            {activePlace.properties.foundedYear && <span>{eraLabel(activePlace.properties.era)}</span>}
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
          <p className="lead">この建物には複数の店舗・場所情報があります。見たい場所を選んでください。</p>
        </div>
      )}

      {places.length > 1 && (
        <div className="building-places">
          <span className="eyebrow">IN THIS BUILDING · {places.length}</span>
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
      <p className="building-caveat">建物色は階情報がある場合は地上階を優先し、階情報がない店は路面店候補として扱った目安です。建物全体の用途を断定するものではありません。</p>
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
          <span className="eyebrow">ABOUT THIS ATLAS</span>
          <h2>街の輪郭ではなく、街の中身を読む。</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="説明を閉じる">×</button>
      </div>
      <div className="about-body">
        <p className="lead">神保町一〜三丁目を、建物、店、創業年代、路地のつながりから理解するための実証版です。</p>
        <div className="about-stats">
          <Stat value={data.summary.buildingCount} label="建物" />
          <Stat value={data.summary.placeCount} label="場所情報" />
          <Stat value={data.summary.bookstoreCount} label="書店" />
          <Stat value={data.summary.alleyCount} label="路地・細街路" />
        </div>
        <h3>読み方</h3>
        <ol>
          <li>「用途」で、古書店・喫茶・飲食がどの通りに連なるかを見る。</li>
          <li>「古書店年代」で、老舗と新しい店が混在する場所を探す。</li>
          <li>「路地」で、表通りから街区内部へ入る細い動線と店の関係を見る。</li>
        </ol>
        <h3>データ上の注意</h3>
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
  const [theme, setTheme] = useState<ThemeKey>("use");
  const [query, setQuery] = useState("");
  const [showPlaces, setShowPlaces] = useState(true);
  const [showAlleys, setShowAlleys] = useState(false);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-kicker">JINBOCHO</span>
          <h1>STREET ATLAS</h1>
          <span className="brand-jp">神保町 路地と建物アトラス</span>
        </div>
        <div className="topbar-center">
          <span className="eyebrow">NOW READING</span>
          <strong>{themeLabels[theme].label}</strong>
        </div>
        <div className="topbar-actions">
          <button type="button" className="text-button" onClick={() => setAboutOpen(true)}>この地図について</button>
          <button type="button" className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="メニューを開く">☰</button>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
          <div className="sidebar-mobile-head">
            <strong>地図の読み方を選ぶ</strong>
            <button type="button" className="icon-button" onClick={() => setSidebarOpen(false)}>×</button>
          </div>
          <div className="search-block">
            <label htmlFor="place-search" className="eyebrow">SEARCH</label>
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
            <span className="eyebrow">READ THE CITY</span>
            <div className="theme-list">
              {(Object.keys(themeLabels) as ThemeKey[]).map((key, index) => (
                <button
                  type="button"
                  key={key}
                  className={`theme-button ${theme === key ? "is-active" : ""}`}
                  onClick={() => { setTheme(key); if (key === "alleys") setShowAlleys(true); }}
                  aria-pressed={theme === key}
                >
                  <span className="theme-number">0{index + 1}</span>
                  <span><strong>{themeLabels[key].short}</strong><small>{themeLabels[key].label}</small></span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
            <p className="theme-description">{themeLabels[theme].description}</p>
          </section>

          <section className="control-section">
            <span className="eyebrow">DETAIL LAYERS</span>
            <div className="toggle-list">
              <Toggle checked={showPlaces} onChange={() => setShowPlaces((value) => !value)} label="店舗ポイント" note="建物内の場所を点で確認" />
              <Toggle checked={showAlleys} onChange={() => setShowAlleys((value) => !value)} label="路地・細街路" note="歩行者道・サービス道路等" />
            </div>
          </section>

          <section className="sidebar-summary">
            <span className="eyebrow">CURRENT COVERAGE</span>
            <div className="summary-grid">
              <Stat value={data.summary.buildingCount} label="建物" />
              <Stat value={data.summary.bookstoreCount} label="書店" />
              <Stat value={data.summary.cafeCount + data.summary.restaurantCount} label="喫茶・飲食" />
              <Stat value={data.summary.bookstoreEraCount} label="年代確認" />
            </div>
            <p>神田神保町一〜三丁目 · OSM観測 {data.summary.osmObservedAt}</p>
          </section>
        </aside>

        <section className="map-wrap">
          <MapView
            data={data}
            theme={theme}
            showPlaces={showPlaces}
            showAlleys={showAlleys}
            selectedBuildingId={selectedBuildingId}
            selectedPlaceId={selectedPlaceId}
            focusPlaceId={focusPlaceId}
            onSelectBuilding={(id) => { setSelectedBuildingId(id); if (!id) setSelectedPlaceId(undefined); }}
            onSelectPlace={selectPlace}
          />
          <div className="map-title-card">
            <span className="eyebrow">THEME</span>
            <strong>{themeLabels[theme].label}</strong>
            <p>{themeLabels[theme].description}</p>
          </div>
          <Legend theme={theme} />
          <button type="button" className="mobile-filter-button" onClick={() => setSidebarOpen(true)}>読み方・検索</button>
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
