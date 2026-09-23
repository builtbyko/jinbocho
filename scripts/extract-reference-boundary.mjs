import fs from "node:fs";
import path from "node:path";

const [sourceArg, outputArg = "data/source/jinbocho-towns.geojson"] = process.argv.slice(2);
if (!sourceArg) {
  console.error("Usage: node scripts/extract-reference-boundary.mjs path/to/towns.json [output]");
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(sourceArg, "utf8"));
const wanted = new Set(["神田神保町一丁目", "神田神保町二丁目", "神田神保町三丁目"]);
const features = source.features
  .filter((feature) => wanted.has(feature.properties?.n))
  .map((feature) => ({
    type: "Feature",
    properties: {
      name: feature.properties.n,
      ward: "千代田区",
      source: "国勢調査町丁・字等別境界データセット（CODH作成）",
      sourceUrl: "https://geoshape.ex.nii.ac.jp/ka/",
      license: "CC BY 4.0",
      extractedAt: "2026-09-22",
    },
    geometry: feature.geometry,
  }));

if (features.length !== 3) {
  throw new Error(`Expected 3 town features, got ${features.length}`);
}

const output = path.resolve(outputArg);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({ type: "FeatureCollection", features })}\n`, "utf8");
console.log(`Wrote ${features.length} features to ${output}`);
