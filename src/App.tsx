import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import { loadAtlasData } from "./data";
import { categoryLabel, eraLegend } from "./palette";
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

function googleMapsUrl(place: PlaceFeature) {
  const { name, address } = place.properties;
  const query = `${name} ${address || "東京都千代田区神田神保町"}`;
  return `https://www.google.com/maps/search/?${new URLSearchParams({api:"1",query})}`;
}

function floorText(value?: string) {
  if (!value) return "";
  if (/^-?\d+(?:\s*[,;]\s*-?\d+)*$/.test(value)) {
    return value.split(/[,;]/).map(level => Number(level) < 0 ? `地下${-Number(level)}階` : `${Number(level) + 1}階`).join("・");
  }
  return value;
}

const initialLayers: Record<LayerKey, boolean> = {
  buildings: true,
  antiquarian_bookstore: true,
  bookstore: true,
  cafe: true,
  restaurant: true,
  other: true,
  bookEra: false,
  alleys: false,
  districtPlan: false,
  roadTypes: false,
};

function MapLegend({
  visibleLayers,
  open,
  onToggle,
}: {
  visibleLayers: Record<LayerKey, boolean>;
  open: boolean;
  onToggle: () => void;
}) {
  const items: { label: string; color: string; line?: boolean }[] = [
    { label: "道路", color: "#e9ebe8" },
    { label: "歩道（登録部分）", color: "#fbfaf7" },
  ];
  if (visibleLayers.buildings) items.push({ label: "灰色の建物", color: "#dadbd6" });
  if (visibleLayers.antiquarian_bookstore) items.push({ label: "古書店", color: "#a6533c" });
  if (visibleLayers.bookstore) items.push({ label: "新刊・専門書店", color: "#d98a4e" });
  if (visibleLayers.cafe) items.push({ label: "喫茶・カフェ", color: "#4f7f78" });
  if (visibleLayers.restaurant) items.push({ label: "飲食店", color: "#7f6b9f" });
  if (visibleLayers.other) {
    items.push(
      { label: "物販・サービス", color: "#7389a6" },
      { label: "文化・教育", color: "#b29a45" },
      { label: "その他", color: "#dadbd6" },
    );
  }
  items.push({label:"街並み再生方針の区域（概略）",color:"#bf4242",line:true});
  if (visibleLayers.districtPlan) items.push({label:"地区計画の区域",color:"#79609a",line:true});
  if (visibleLayers.roadTypes) items.push({label:"都道",color:"#b78a2e",line:true},{label:"区道",color:"#4480ab",line:true},{label:"区分未確認",color:"#929894",line:true});
  if (visibleLayers.alleys) items.push({ label: "路地・細街路", color: "#495753", line: true });
  if (!items.length && !visibleLayers.bookEra) return null;

  return (
    <aside className={`map-legend ${open ? "is-open" : ""}`} aria-label="凡例">
      <button className="map-legend-toggle" type="button" onClick={onToggle} aria-expanded={open}>
        <span>凡例</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="map-legend-body">
          <div className="map-legend-list">
            {items.map((item) => (
              <div className="map-legend-item" key={item.label}>
                <span
                  className={item.line ? "map-legend-swatch is-line" : "map-legend-swatch"}
                  style={item.line ? { borderColor: item.color } : { backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          {visibleLayers.bookEra && (
            <div className="map-legend-era">
              <h2>古書店の創業年代</h2>
              <div className="map-legend-list">
                {eraLegend.filter(([key]) => key !== "unknown").map(([key, label, color]) => (
                  <div className="map-legend-item" key={key}>
                    <span className="map-legend-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="map-legend-note">色付きは建物の代表的な店の種類。建物を押すと店を確認できます。</p>
          {visibleLayers.buildings && <p className="map-legend-note">灰色は店の情報がない、地上階の店が未判定、または非表示中の種類です。住宅・空き店舗を示す色ではありません。</p>}
        </div>
      )}
    </aside>
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
          {p.floor ? ` · ${floorText(p.floor)}` : ""}
          {p.foundingDisplay ? ` · ${p.foundingDisplay}` : p.foundedYear ? ` · 創業${p.foundedYear}年` : ""}
        </small>
        {p.description && <span className="place-card-description">{p.description}</span>}
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
              {activePlace.properties.confidence === "confirmed" ? "出典確認" : "OSM参考"}
            </span>
          </div>
          <a className="google-maps-link" href={googleMapsUrl(activePlace)} target="_blank" rel="noopener noreferrer" aria-label={`${activePlace.properties.name}をGoogle マップで開く`}>
            Google マップで開く <span aria-hidden="true">↗</span>
          </a>
          {activePlace.properties.bookwalkImported && (
            <dl className="history-dates">
              <div><dt>{activePlace.properties.foundingLabel ?? "店の創業"}</dt><dd>{activePlace.properties.foundingDisplay}</dd></div>
              <div><dt>建物の竣工</dt><dd>{activePlace.properties.buildingCompletedText}</dd></div>
            </dl>
          )}
          {activePlace.properties.lookFor && <section className="look-for">
            <h3>ここで見るところ</h3><p>{activePlace.properties.lookFor}</p>
            <a href={activePlace.properties.lookForSourceUrl} target="_blank" rel="noreferrer">見どころの出典 ↗</a>
          </section>}
          {activePlace.properties.photo && <details className="exterior-photo" key={activePlace.properties.id}>
            <summary>外観写真 <span>{activePlace.properties.photo.takenAt}撮影</span></summary>
            <figure>
              <a href={activePlace.properties.photo.sourceUrl} target="_blank" rel="noreferrer" aria-label="写真の原典を開く">
                <img src={`${import.meta.env.BASE_URL}${activePlace.properties.photo.src}?v=${import.meta.env.VITE_ATLAS_DATA_VERSION}`} alt={activePlace.properties.photo.alt} loading="lazy" decoding="async" />
              </a>
              <figcaption>{activePlace.properties.photo.note}<br />
                写真：{activePlace.properties.photo.author} ／ <a href={activePlace.properties.photo.licenseUrl} target="_blank" rel="noreferrer">{activePlace.properties.photo.license}</a><br />
                <a href={activePlace.properties.photo.sourceUrl} target="_blank" rel="noreferrer">Wikimedia Commons</a> · {activePlace.properties.photo.changes}
              </figcaption>
            </figure>
          </details>}
          {activePlace.properties.bookwalkImported && <h3 className="history-heading">この場所の歴史</h3>}
          {(activePlace.properties.description || activePlace.properties.specialty) && (
            <p className="lead place-description">{activePlace.properties.description || activePlace.properties.specialty}</p>
          )}
          {activePlace.properties.buildingDescription && (
            <section><h3 className="history-heading">建物について</h3><p className="lead place-description">{activePlace.properties.buildingDescription}</p></section>
          )}
          <dl className="fact-list">
            {!activePlace.properties.foundingDisplay && yearText("創業", activePlace.properties.foundedYear) && <><dt>店の歴史</dt><dd>{yearText("創業", activePlace.properties.foundedYear)}</dd></>}
            {yearText("神保町で開業", activePlace.properties.jinbochoOpenedYear) && <><dt>神保町</dt><dd>{yearText("開業", activePlace.properties.jinbochoOpenedYear)}</dd></>}
            {yearText("現在地へ移転", activePlace.properties.currentLocationSince) && <><dt>現在地</dt><dd>{yearText("移転", activePlace.properties.currentLocationSince)}</dd></>}
            {activePlace.properties.floor && <><dt>階</dt><dd>{floorText(activePlace.properties.floor)}</dd></>}
            {activePlace.properties.address && <><dt>住所</dt><dd>{activePlace.properties.address}</dd></>}
            {activePlace.properties.hours && <><dt>営業時間</dt><dd>{activePlace.properties.hours}</dd></>}
            {activePlace.properties.notableReason && <><dt>掲載根拠</dt><dd>{activePlace.properties.notableReason}</dd></>}
          </dl>
          {activePlace.properties.note && <p className="detail-note">{activePlace.properties.note}</p>}
          {activePlace.properties.visitNote && <p className="detail-note">{activePlace.properties.visitNote}</p>}
          <div className="source-box">
            <span>出典 · {activePlace.properties.observedAt}確認</span>
            {activePlace.properties.historySources?.length ? activePlace.properties.historySources.map(source => (
              <a href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
            )) : <a href={activePlace.properties.sourceUrl} target="_blank" rel="noreferrer">{activePlace.properties.sourceLabel} ↗</a>}
            {!activePlace.properties.historySources?.length && activePlace.properties.descriptionSourceUrl && activePlace.properties.descriptionSourceUrl !== activePlace.properties.sourceUrl && (
              <a href={activePlace.properties.descriptionSourceUrl} target="_blank" rel="noreferrer">{activePlace.properties.descriptionSourceLabel ?? "紹介の出典"} ↗</a>
            )}
            {activePlace.properties.website && activePlace.properties.website !== activePlace.properties.sourceUrl && activePlace.properties.website !== activePlace.properties.descriptionSourceUrl && !activePlace.properties.historySources?.some(source => source.url === activePlace.properties.website) && (
              <a href={activePlace.properties.website} target="_blank" rel="noreferrer">{activePlace.properties.infoLabel ?? "案内・店舗情報"} ↗</a>
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
        <p className="lead">神田神保町一〜三丁目の建物と店舗、周辺の歴史ある場所を表示しています。建物や地点を押すと詳細が開きます。「歴史・建物の解説」には、創業・創立年と建築年代を区別して調べた15か所をまとめています。</p>
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
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            道路・歩道・通り名 · OpenStreetMap ↗
          </a>
          <a href="https://geoshape.ex.nii.ac.jp/ka/" target="_blank" rel="noreferrer">町丁目境界 · CODH ↗</a>
        </div>
        <p>道路幅と歩道の形は概略です。歩道はOSMに歩道として登録された範囲を表示しています。</p>
      </div>
    </aside>
  );
}

export default function App() {
  const [data, setData] = useState<AtlasData>();
  const [error, setError] = useState<string>();
  const [visibleLayers, setVisibleLayers] = useState<Record<LayerKey, boolean>>(initialLayers);
  const [legendOpen, setLegendOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>();
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>();
  const [focusPlaceId, setFocusPlaceId] = useState<string>();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const closePanels = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSidebarOpen(false); setAboutOpen(false); setLegendOpen(false);
      setSelectedBuildingId(undefined); setSelectedPlaceId(undefined);
    };
    window.addEventListener("keydown", closePanels);
    return () => window.removeEventListener("keydown", closePanels);
  }, []);

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
      .filter(({ properties: p }) => normalize([p.name, ...(p.aliases ?? []), p.specialty ?? "", p.description ?? "", p.buildingDescription ?? "", p.foundingDisplay ?? "", p.buildingCompletedText ?? "", p.address ?? ""].join(" ")).includes(needle))
      .sort((a, b) => Number(b.properties.confidence === "confirmed") - Number(a.properties.confidence === "confirmed"))
      .slice(0, 8);
  }, [data, query]);

  const selectPlace = (id?: string) => {
    setSelectedPlaceId(id);
    if (!id) return;
    setLegendOpen(false);
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
    {
      id: "bookEra", name: "創業年代", color: "#6c3328",
      count: data.places.features.filter(({ properties: place }) => place.category === "antiquarian_bookstore"
        && place.buildingId && place.foundedYear && place.era !== "unknown").length,
    },
    { id: "bookstore", name: "新刊・専門書店", color: "#d98a4e", count: countCategory("bookstore") },
    { id: "cafe", name: "喫茶・カフェ", color: "#4f7f78", count: data.summary.cafeCount },
    { id: "restaurant", name: "飲食店", color: "#7f6b9f", count: data.summary.restaurantCount },
    { id: "other", name: "その他の店・施設", color: "#7389a6", count: otherCount },
    { id: "districtPlan", name: "地区計画", color: "#79609a", count: 1, line: true },
    { id: "roadTypes", name: "道路の種類", color: "#4480ab", count: data.roadClassification.features.length, line: true },
    { id: "alleys", name: "路地・細街路", color: "#495753", count: data.summary.alleyCount, line: true },
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <h1>神保町の地図</h1>
          <span className="brand-jp">古書店・建物・歴史</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="text-button" onClick={() => { setLegendOpen(false); setAboutOpen(true); }}>データについて</button>
          <button type="button" className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="場所とレイヤーを開く">探す</button>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
          <div className="sidebar-mobile-head">
            <strong>場所とレイヤー</strong>
            <button type="button" className="icon-button" onClick={() => setSidebarOpen(false)} aria-label="レイヤーを閉じる">×</button>
          </div>
          <div className="search-block">
            <label htmlFor="place-search">場所を探す</label>
            <div className="search-input-wrap">
              <span aria-hidden="true">⌕</span>
              <input id="place-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・歴史・建築年" autoComplete="off" />
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

          <details className="history-place-list">
            <summary>歴史・建物の解説 <span>{data.places.features.filter(place => place.properties.bookwalkImported).length}か所</span></summary>
            <p className="history-list-note">地図の「i」が目印です。場所を選ぶと解説が開きます。</p>
            {data.places.features.filter(place => place.properties.bookwalkImported).map(place => (
              <PlaceCard key={place.properties.id} place={place} isSelected={selectedPlaceId === place.properties.id} onSelect={() => selectPlace(place.properties.id)} />
            ))}
          </details>

          <section className="control-section">
            <h2>レイヤー</h2>
            <div className="layer-list">
              {layers.map((layer) => (
                <label
                  className={layer.id === "antiquarian_bookstore" ? "layer-row is-book-group-start" : layer.id === "bookEra" ? "layer-row is-book-group-end" : "layer-row"}
                  key={layer.id}
                >
                  <input
                    type="checkbox"
                    checked={visibleLayers[layer.id]}
                    aria-label={layer.id === "bookEra" ? "古書店の創業年代" : undefined}
                    onChange={() => setVisibleLayers((current) => ({ ...current, [layer.id]: !current[layer.id] }))}
                  />
                  <span
                    className={layer.line ? "layer-swatch is-line" : layer.id === "bookEra" ? "layer-swatch is-era" : "layer-swatch"}
                    style={{ backgroundColor: layer.line || layer.id === "bookEra" ? undefined : layer.color, borderColor: layer.color }}
                    aria-hidden="true"
                  />
                  <span className="layer-name">{layer.name}</span>
                  <span className="layer-count">{layer.id === "roadTypes" ? "" : layer.count}</span>
                </label>
              ))}
            </div>
            <div className="planning-note">
              <p><i className="regeneration-swatch" />街並み再生方針の区域（常時表示）</p>
              <a href="https://www.metro.tokyo.lg.jp/documents/d/tosei/20261016_01_07" target="_blank" rel="noreferrer">東京都の区域図 ↗</a>
              <p>赤点線は公式区域図から読み取った概略です。</p>
              {visibleLayers.districtPlan && <p>紫の線：一ツ橋二丁目周辺地区地区計画。<a href="https://www.city.chiyoda.lg.jp/documents/4355/15hitotsubashi.pdf" target="_blank" rel="noreferrer">計画図 ↗</a></p>}
              {visibleLayers.roadTypes && <><p>黄：都道／青：区道／灰：未確認。道路名の六角形は都道番号です。</p><p>道路区分は白地図の範囲。掲載範囲の国道・私道は確認できていません。区道の一部はOSM参考です。</p><a href="https://www.city.chiyoda.lg.jp/documents/28493/rosenmozu_5.pdf" target="_blank" rel="noreferrer">千代田区路線網図 ↗</a></>}
            </div>
            <p className="layer-note">数字は件数（店は店舗数）。色は建物の代表用途です。拡大すると店名が表示されます。建物や店名を押すと、入っている店が見られます。</p>
            {visibleLayers.buildings && <p className="layer-note">灰色の建物は店の情報なし・地上階の店が未判定・非表示中の種類。住宅や空き店舗を示す色ではありません。</p>}
            {visibleLayers.bookEra && <p className="layer-note">創業年代を確認できた古書店のみ色分けします。</p>}
          </section>
        </aside>

        <section className="map-wrap">
          <MapView
            data={data}
            visibleLayers={visibleLayers}
            selectedBuildingId={selectedBuildingId}
            focusPlaceId={focusPlaceId}
            onSelectBuilding={(id) => { setSelectedPlaceId(undefined); setSelectedBuildingId(id); if (id) setLegendOpen(false); }}
            onSelectPlace={(id) => selectPlace(id)}
            onOverview={() => { setSelectedBuildingId(undefined); setSelectedPlaceId(undefined); setAboutOpen(false); setLegendOpen(false); }}
          />
          <MapLegend visibleLayers={visibleLayers} open={legendOpen} onToggle={() => setLegendOpen((value) => !value)} />
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
