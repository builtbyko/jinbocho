import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
for(const name of ["planning-areas.geojson","road-classification.geojson"]){
 fs.copyFileSync(path.join(root,"data/curated",name),path.join(root,"public/data",name));
}
const labelDetails=JSON.parse(fs.readFileSync(path.join(root,"data/curated/road-labels.json"),"utf8"));
const labelPath=path.join(root,"public/data/basemap-road-names.geojson");
const labels=JSON.parse(fs.readFileSync(labelPath,"utf8"));
for(const feature of labels.features) Object.assign(feature.properties,labelDetails[feature.properties.name] ?? {displayName:feature.properties.name,roadKind:"unknown",routeIcon:""});
fs.writeFileSync(labelPath,JSON.stringify(labels)+"\n");
console.log("Planning areas, road classification and labels synced.");
