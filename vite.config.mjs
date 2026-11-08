import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const dataDirectory = new URL("./public/data/", import.meta.url);
const dataHash = createHash("sha256");
for (const filename of readdirSync(dataDirectory).sort()) {
  dataHash.update(filename).update(readFileSync(new URL(filename, dataDirectory)));
}
const dataVersion = dataHash.digest("hex").slice(0, 12);

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { "import.meta.env.VITE_ATLAS_DATA_VERSION": JSON.stringify(dataVersion) },
  base: mode === "development" ? "/" : "/jinbocho/",
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  build: {
    sourcemap: true,
  },
}));
