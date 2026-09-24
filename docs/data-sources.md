# Data sources and reuse notes

| Dataset | Use in this repository | Terms / note |
|---|---|---|
| [東京都「令和3年度区部土地利用現況調査」建物現況GISデータ](https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000019) | Building polygons clipped to 神田神保町1–3. Source archive: [`R03.zip`](https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/R03.zip) | Cite source and processing. Raw source is not committed. |
| OpenStreetMap | Place candidates and alley/footway geometry | © OpenStreetMap contributors, ODbL. Generated OSM-derived GeoJSON retains attribution. |
| OpenStreetMap API map extract | White basemap road centerlines, explicitly mapped sidewalks, and street names | © OpenStreetMap contributors, ODbL. Road widths are schematic where OSM has no width tag; the output is not a surveyed curb or land-boundary map. |
| 国勢調査町丁・字等別境界データセット (CODH) | Three-town boundary | CC BY 4.0; processed extract. |
| Store official sites | Founding year, move year, specialty, address | Only factual fields and links are recorded; descriptions and photos are not copied. |
| 千代田区観光協会 Visit Chiyoda | Official-tourism listing, founding year, address | Factual fields and source links only; photos and article text are not reproduced. |

## Not used as stored map data

- Google Maps / Google Places ratings and reviews
- 食べログ ratings, review counts, or review text
- BOOKTOWNじんぼう bulk shop list or map geometry (reuse permission has not been obtained)
- 千代田区道路台帳平面図 geometry

## Recommended next permission request

Ask BOOKTOWNじんぼう / 神田古書店連盟 whether the current member shop name, address and specialty list may be reused in an attributed open neighborhood map. Until permission is clear, this repository uses OSM candidates plus individually verified official sources.
