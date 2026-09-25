import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const curatedPath = path.join(root, "data/curated/places.json");
const placesPath = path.join(root, "public/data/places.geojson");
const curated = JSON.parse(fs.readFileSync(curatedPath, "utf8"));
const places = JSON.parse(fs.readFileSync(placesPath, "utf8"));
const byId = new Map(places.features.map((feature) => [feature.properties.id, feature]));

for (const record of curated.places) {
  if (typeof record.description !== "string" || !record.description.trim()) {
    throw new Error(`${record.id}: 短い店舗紹介がありません`);
  }
  const feature = byId.get(record.id);
  if (!feature) throw new Error(`${record.id}: 公開データにない店は地図データの再生成が必要です`);
  for (const key of ["name", "category", "address", "floor", "foundedYear"]) {
    if ((feature.properties[key] ?? null) !== (record[key] ?? null)) {
      throw new Error(`${record.id}: ${key} が変わりました。位置・分類・年代を含む地図データを再生成してください`);
    }
  }
  if (Boolean(record.descriptionSourceUrl) !== Boolean(record.descriptionSourceLabel)) {
    throw new Error(`${record.id}: 紹介文の出典URLと名称は両方必要です`);
  }
  Object.assign(feature.properties, record, { observedAt: curated.checkedAt });
}

places.metadata.curatedCheckedAt = curated.checkedAt;
fs.writeFileSync(placesPath, `${JSON.stringify(places)}\n`, "utf8");
console.log(`${curated.places.length}店の紹介・履歴・出典を既存の店舗位置を保って反映しました。`);
