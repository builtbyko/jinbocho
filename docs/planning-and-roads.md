# 区域と道路の表示

## 街並み再生方針（常時表示）
東京都の2026年10月16日指定「神田神保町地区」約14ha。公式区域図1頁を道路交差点で位置合わせし、境界を読取りました。赤点線は表示上の概略で、敷地ごとの適用判断用ではありません。対応点は `data/curated/planning-area-controls.json` に保存しています。読取り面積は約14.07haです。
出典：https://www.metro.tokyo.lg.jp/documents/d/tosei/20261016_01_07

## 地区計画（初期非表示）
正式名称は一ツ橋二丁目周辺地区地区計画、約12.4ha。平成16年6月21日変更の図書と照合し、国土交通省公開の令和7年度都市計画GISデータから当該区域を抽出しました。JGD2011の経緯度を使用しています。
図書：https://www.city.chiyoda.lg.jp/documents/4355/15hitotsubashi.pdf
GIS：https://www.mlit.go.jp/toshi/tosiko/content/001904020.zip
配布案内：https://www.mlit.go.jp/toshi/tosiko/toshi_tosiko_tk_000182.html

## 道路区分
形状は既存のOSMスナップショットを白地図範囲で切り抜いた中心線です。道路の法的区域・幅員・土地所有を示すものではありません。
白山通り301号・靖国通り302号は東京都第一建設事務所資料に照合。専大通り・雉子橋通り・さくら通り・すずらん通りは千代田区路線網図に照合しています。道路名の六角形は都道番号の図式表現です。
区道の一部は公式路線網図の区道表示とOSM中心線の位置を照合した参考表示です。中間3点がすべて5m以内で重なる道だけを追加し、対応点・閾値を `road-classification-controls.json` に保存しています。
国道と私道は今回の白地図範囲では確定できていません。国道・都道・区道に分類できない道を私道とは判定しません。access=private も所有権の根拠には使いません。
道路資料：https://www.city.chiyoda.lg.jp/documents/28493/rosenmozu_5.pdf
都道資料：https://www.kensetsu.metro.tokyo.lg.jp/content/000065482.pdf
OSM：https://www.openstreetmap.org/copyright

## 更新
編集元は `data/curated/planning-areas.geojson`、`road-classification.geojson`、`road-labels.json`。`node scripts/sync-context-layers.mjs` で公開データに同期します。ベースマップの再生成時も道路名の付加情報を維持します。
