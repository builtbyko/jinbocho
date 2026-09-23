# JINBOCHO STREET ATLAS

神保町一〜三丁目を、建物・店・路地の粒度で読むための実験的な街のアトラスです。

公開予定URL: <https://builtbyko.github.io/jinbocho/>

## いま見られるもの

- 東京都「令和3年度区部土地利用現況調査」の建物ポリゴンを、神田神保町一〜三丁目へ切り出して表示
- 建物を「古書・新刊書店／喫茶・カフェ／飲食／物販・サービス／文化・学び」で色分け
- 古書店を創業年代（戦前、1945〜1969年、1970〜1999年、2000年以降、不明）で比較
- 路地・歩行者道・細街路を建物の上に重ねて表示
- 店名・専門分野・住所を横断検索し、建物内の複数店舗を詳細カードで確認
- 情報ごとに出典、確認日、公式情報かOSM参考情報かを表示

初版はデータ設計と読み方の検証版です。店舗の網羅性や営業状況を保証するものではありません。

## 開発

Node.js 22.13以上を使います。

```bash
npm install
npm run dev
```

ビルドとデータ検証:

```bash
npm test
```

GeoJSONを再生成する場合はPython 3.11以上と地理空間ライブラリを用意します。

```bash
python -m pip install -r requirements.txt
```

OpenStreetMapからデータを再取得する場合:

```bash
python scripts/build_jinbocho_data.py --fetch
```

取得済みの `data/raw/osm-jinbocho.json` から再生成する場合:

```bash
python scripts/build_jinbocho_data.py
```

東京都の建物現況Shapefileを指定して再生成する場合:

```bash
python scripts/build_jinbocho_data.py --building-source "path/to/R03建物現況.shp"
```

未指定時は `data/raw/tokyo-land-use-2021/R03建物現況.shp` を探し、見つからなければOSM建物へフォールバックします。公式GISデータは[東京都オープンデータカタログ](https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000019)の [`R03.zip`](https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/R03.zip) から取得してください。

## データの考え方

- 建物ポリゴンは東京都「令和3年度区部土地利用現況調査」の建物現況を加工しています。
- 店舗候補と路地・細街路は © OpenStreetMap contributors（ODbL）の参考データです。
- 町丁目境界は国勢調査町丁・字等別境界データセット（CODH作成）を加工しています。
- 古書店の創業年などは店舗公式サイト等を個別に確認し、`data/curated/places.json` に出典と確認日を保存します。
- 「創業年」「神保町での開業年」「現在地への移転年」は別の値です。地図の年代表示は、明記がない限り創業年です。
- 飲食店を一律に「人気」と断定しません。掲載理由や受賞・選定等の根拠がある場合に、その指標名と確認日を示します。
- 一棟に複数店舗がある場合、階情報がある店は地上階を優先し、階情報がない店は路面店候補として建物色を決めます。建物全体の用途を示すものではありません。

詳しい方法は [docs/methodology.md](docs/methodology.md) を参照してください。
