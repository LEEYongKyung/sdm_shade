import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import xlsx from "xlsx";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..", "..");
const sourceDataDir = path.resolve(appRoot, process.env.SOURCE_DATA_DIR || "../\uc0ac\uc6a9 \ub370\uc774\ud130");
const reportDir = path.resolve(appRoot, "reports");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

fs.mkdirSync(reportDir, { recursive: true });

const ko = {
  crosswalkToken: "\uc11c\uc6b8\uc2dc \ub300\ub85c\ubcc0 \ud6a1\ub2e8\ubcf4\ub3c4",
  shelterToken: "\uc11c\uc6b8\uc2dc \ubb34\ub354\uc704\uc27c\ud130",
  intersectionToken: "\uc11c\uc6b8\uc2dc \uad50\ucc28\ub85c",
  roadRouteToken: "\uc11c\uc6b8\uc2dc \ub3c4\ub85c\ub178\uc120",
  seodaemun: "\uc11c\ub300\ubb38\uad6c",
  nodeId: "\ub178\ub4dc ID",
  districtName: "\uc2dc\uad70\uad6c\uba85",
  shelterName: "\uc27c\ud130\uba85\uce6d",
  roadAddress: "\ub3c4\ub85c\uba85\uc8fc\uc18c",
  intersectionCode: "\uad50\ucc28\ub85c\ucf54\ub4dc",
  routeName: "\ub178\uc120\uba85(\ub3c4\ub85c\uba85)"
};

const datasets = [
  {
    id: "crosswalk",
    name: "Seoul boulevard crosswalk locations",
    key: process.env.SEOUL_CROSSWALK_API_KEY,
    service: process.env.SEOUL_CROSSWALK_SERVICE || "tbTraficCrsng",
    localFileToken: ko.crosswalkToken,
    apiKeyField: "NODE_ID",
    localKeyField: ko.nodeId,
    apiDistrictField: "SGG_NM",
    localDistrictField: ko.districtName,
    districtValue: ko.seodaemun,
    sampleFields: ["NODE_ID", "SGG_NM", "EMD_NM", "NODE_WKT"]
  },
  {
    id: "cooling_shelter",
    name: "Seoul cooling shelters",
    key: process.env.SEOUL_COOLING_SHELTER_API_KEY,
    service: process.env.SEOUL_COOLING_SHELTER_SERVICE || "TbGtnHwcwP",
    localFileToken: ko.shelterToken,
    apiKeyField: ["R_AREA_NM", "R_DETL_ADD"],
    localKeyField: [ko.shelterName, ko.roadAddress],
    apiDistrictField: "R_DETL_ADD",
    localDistrictField: ko.roadAddress,
    districtValue: ko.seodaemun,
    districtContains: true,
    sampleFields: ["R_AREA_NM", "R_DETL_ADD", "LOTNO_ADDR", "LAT", "LOT"]
  },
  {
    id: "intersection",
    name: "Seoul intersection information",
    key: process.env.SEOUL_INTERSECTION_API_KEY,
    service: process.env.SEOUL_INTERSECTION_SERVICE || "trafficSafetyA008PInfo",
    localFileToken: ko.intersectionToken,
    apiKeyField: "INTR_CD",
    localKeyField: ko.intersectionCode,
    sampleFields: ["INTR_CD", "INTR_NM", "GU_CD", "X", "Y"]
  },
  {
    id: "road_route",
    name: "Seoul road route information",
    key: process.env.SEOUL_ROAD_ROUTE_API_KEY,
    service: process.env.SEOUL_ROAD_ROUTE_SERVICE || "viRoutDt",
    localFileToken: ko.roadRouteToken,
    apiKeyField: "ROD_NAM",
    localKeyField: ko.routeName,
    sampleFields: ["ROD_NAM", "ROAD_TYPE", "ROAD_FUNC", "ROAD_SCALE", "ROAD_WIDTH"]
  }
];

const workbook = xlsx.utils.book_new();
const summaryRows = [];
const detail = {};

for (const dataset of datasets) {
  console.log(`Fetching ${dataset.id}...`);
  const apiRows = await fetchSeoulOpenApiRows(dataset);
  const localPath = findLocalFile(dataset.localFileToken);
  const localRows = readCsv(localPath);
  const comparison = compareRows(dataset, apiRows, localRows);

  detail[dataset.id] = {
    ...comparison,
    localPath
  };

  summaryRows.push({
    dataset: dataset.id,
    name: dataset.name,
    api_total: comparison.api.total,
    local_total: comparison.local.total,
    api_district: comparison.api.district,
    local_district: comparison.local.district,
    api_only_total_count: comparison.onlyInApi.count,
    local_only_total_count: comparison.onlyInLocal.count,
    api_only_district_count: comparison.onlyInApiDistrict.count,
    local_only_district_count: comparison.onlyInLocalDistrict.count,
    verdict: comparison.verdict
  });

  addSheet(`${dataset.id}_api_only`, comparison.onlyInApi.sample);
  addSheet(`${dataset.id}_local_only`, comparison.onlyInLocal.sample);
  addSheet(`${dataset.id}_api_only_d`, comparison.onlyInApiDistrict.sample);
  addSheet(`${dataset.id}_local_only_d`, comparison.onlyInLocalDistrict.sample);
}

addSheet("summary", summaryRows);

const jsonPath = path.resolve(reportDir, `openapi-local-compare-${timestamp}.json`);
const xlsxPath = path.resolve(reportDir, `openapi-local-compare-${timestamp}.xlsx`);
fs.writeFileSync(
  jsonPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), sourceDataDir, summary: summaryRows, detail }, null, 2),
  "utf8"
);
xlsx.writeFile(workbook, xlsxPath);

console.log(JSON.stringify({ jsonPath, xlsxPath, summary: summaryRows }, null, 2));

async function fetchSeoulOpenApiRows(dataset) {
  if (!dataset.key) {
    throw new Error(`${dataset.id} API key is not configured.`);
  }

  const first = await fetchPage(dataset, 1, 1);
  const root = first[dataset.service];
  if (!root?.RESULT || root.RESULT.CODE !== "INFO-000") {
    throw new Error(`${dataset.id} API failed: ${JSON.stringify(root?.RESULT || first)}`);
  }

  const total = Number(root.list_total_count || 0);
  const rows = [];
  const pageSize = 1000;
  for (let start = 1; start <= total; start += pageSize) {
    const end = Math.min(start + pageSize - 1, total);
    const payload = await fetchPage(dataset, start, end);
    const pageRoot = payload[dataset.service];
    rows.push(...array(pageRoot.row));
    process.stdout.write(`  ${dataset.id} ${end}/${total}\r`);
  }
  process.stdout.write("\n");
  return rows;
}

async function fetchPage(dataset, start, end) {
  const url = `http://openapi.seoul.go.kr:8088/${dataset.key}/json/${dataset.service}/${start}/${end}/`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${dataset.id} HTTP ${response.status}`);
  }
  return response.json();
}

function compareRows(dataset, apiRows, localRows) {
  const apiDistrictRows = filterDistrict(apiRows, dataset.apiDistrictField, dataset.districtValue, dataset.districtContains);
  const localDistrictRows = filterDistrict(localRows, dataset.localDistrictField, dataset.districtValue, dataset.districtContains);

  const apiMap = keyMap(dataset.apiKeyField, apiRows, dataset.sampleFields);
  const localMap = keyMap(dataset.localKeyField, localRows);
  const apiDistrictMap = keyMap(dataset.apiKeyField, apiDistrictRows, dataset.sampleFields);
  const localDistrictMap = keyMap(dataset.localKeyField, localDistrictRows);

  const onlyInApi = difference(apiMap, localMap);
  const onlyInLocal = difference(localMap, apiMap);
  const onlyInApiDistrict = difference(apiDistrictMap, localDistrictMap);
  const onlyInLocalDistrict = difference(localDistrictMap, apiDistrictMap);

  const verdict =
    apiRows.length === localRows.length && onlyInApi.length === 0 && onlyInLocal.length === 0
      ? "full_match"
      : apiDistrictRows.length > 0 &&
          apiDistrictRows.length === localDistrictRows.length &&
          onlyInApiDistrict.length === 0 &&
          onlyInLocalDistrict.length === 0
        ? "district_match"
        : "needs_review";

  return {
    api: { total: apiRows.length, district: apiDistrictRows.length },
    local: { total: localRows.length, district: localDistrictRows.length },
    onlyInApi: { count: onlyInApi.length, sample: onlyInApi.slice(0, 500) },
    onlyInLocal: { count: onlyInLocal.length, sample: onlyInLocal.slice(0, 500) },
    onlyInApiDistrict: { count: onlyInApiDistrict.length, sample: onlyInApiDistrict.slice(0, 500) },
    onlyInLocalDistrict: { count: onlyInLocalDistrict.length, sample: onlyInLocalDistrict.slice(0, 500) },
    verdict
  };
}

function readCsv(filePath) {
  const buffer = fs.readFileSync(filePath);
  const utf8 = buffer.toString("utf8");
  const content = utf8.includes("\ufffd") ? new TextDecoder("euc-kr").decode(buffer) : utf8;
  return parse(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true
  });
}

function findLocalFile(token) {
  const file = fs
    .readdirSync(sourceDataDir)
    .find((name) => name.includes(token) && name.toLowerCase().endsWith(".csv"));
  if (!file) throw new Error(`Local file not found for token: ${token}`);
  return path.resolve(sourceDataDir, file);
}

function filterDistrict(rows, field, value, contains = false) {
  if (!field || !value) return rows;
  return rows.filter((row) => {
    const actual = String(row[field] ?? "");
    return contains ? actual.includes(value) : actual === value;
  });
}

function keyMap(field, rows, sampleFields = []) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeKey(field, row);
    if (!key || map.has(key)) continue;
    map.set(key, sampleRow(key, row, sampleFields));
  }
  return map;
}

function sampleRow(key, row, fields) {
  const sample = { key };
  for (const field of fields) {
    if (row[field] !== undefined && row[field] !== "") {
      sample[field] = row[field];
    }
  }
  return sample;
}

function normalizeKey(field, row) {
  const fields = Array.isArray(field) ? field : [field];
  return fields
    .map((name) => String(row[name] ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ");
}

function difference(left, right) {
  return [...left.entries()]
    .filter(([key]) => !right.has(key))
    .map(([, row]) => row)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function addSheet(name, rows) {
  const sheet = xlsx.utils.json_to_sheet(rows.length ? rows : [{ message: "no rows" }]);
  xlsx.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}
