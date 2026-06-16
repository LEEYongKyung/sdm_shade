import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import xlsx from "xlsx";
import { config } from "../config.js";
import {
  epsg5186ToWgs84,
  parseWktPoint,
  routeNameFromAddress
} from "./geo.js";

let cached;

export function clearCache() {
  cached = undefined;
}

export function loadLocalData() {
  if (cached) return cached;

  const sourceDir = config.sourceDataDir;
  const oldAppDataDir = path.resolve(
    config.projectRoot,
    "seodaemun_leaflet_with_top100_sidebar_separate_layers_colored_clusters_and_csv_download",
    "data"
  );

  const crosswalks = loadCrosswalks(findFile(sourceDir, "횡단보도"));
  const shelters = loadShelters(findFile(sourceDir, "무더위쉼터"));
  const intersections = loadIntersections(findFile(sourceDir, "교차로"));
  const roads = loadRoadRoutes(findFile(sourceDir, "도로노선"));
  const elderly = loadElderly(findFile(sourceDir, "고령자"));
  const existingShades = loadExistingShades(
    path.resolve(oldAppDataDir, "shade_existing.csv")
  );
  const sidewalks = loadSidewalks(findProjectFile("25.12", ".xlsx"));
  const legacyTop100 = loadLegacyTop100(
    path.resolve(oldAppDataDir, "candidate_top100_download.csv")
  );

  cached = {
    crosswalks,
    shelters,
    intersections,
    roads,
    elderly,
    existingShades,
    sidewalks,
    legacyTop100
  };

  return cached;
}

export function parseInstalledShadeFile(filePath, year) {
  const ext = path.extname(filePath).toLowerCase();
  const rows =
    ext === ".csv"
      ? readCsv(filePath)
      : xlsx.utils.sheet_to_json(xlsx.readFile(filePath).Sheets[xlsx.readFile(filePath).SheetNames[0]], {
          defval: ""
        });

  return rows
    .map((row, index) => {
      const longitude = numberFrom(row["경도"] ?? row.longitude ?? row.lng);
      const latitude = numberFrom(row["위도"] ?? row.latitude ?? row.lat);
      return {
        managementNo: String(row["관리번호"] ?? row["번호"] ?? row.id ?? `upload-${index + 1}`),
        name: String(row["설치장소명"] ?? row["장소"] ?? row["주소"] ?? row.name ?? ""),
        installedYear: Number(year) || new Date().getFullYear(),
        longitude,
        latitude,
        raw: row
      };
    })
    .filter((row) => Number.isFinite(row.longitude) && Number.isFinite(row.latitude));
}

function loadCrosswalks(filePath) {
  return readCsv(filePath)
    .filter((row) => row["시군구명"] === "서대문구")
    .map((row) => {
      const point = parseWktPoint(row["노드 WKT"]);
      return {
        nodeId: String(row["노드 ID"]),
        dongName: row["읍면동명"] || "",
        districtName: row["시군구명"] || "",
        longitude: point?.longitude,
        latitude: point?.latitude,
        raw: row
      };
    })
    .filter((row) => Number.isFinite(row.longitude) && Number.isFinite(row.latitude));
}

function loadShelters(filePath) {
  return readCsv(filePath)
    .map((row) => ({
      name: row["쉼터명칭"],
      roadAddress: row["도로명주소"],
      longitude: numberFrom(row["경도"]),
      latitude: numberFrom(row["위도"]),
      raw: row
    }))
    .filter((row) => inSeodaemun(row));
}

function loadIntersections(filePath) {
  return readCsv(filePath)
    .map((row) => {
      const point = epsg5186ToWgs84(row["X좌표"], row["Y좌표"]);
      return {
        code: row["교차로코드"],
        name: row["교차로명칭"],
        longitude: point?.longitude,
        latitude: point?.latitude,
        raw: row
      };
    })
    .filter((row) => inSeodaemun(row));
}

function loadRoadRoutes(filePath) {
  return readCsv(filePath).map((row) => ({
    routeName: row["노선명(도로명)"],
    roadType: row["도로종류"],
    roadFunction: row["도로기능"],
    roadScale: row["도로규모"],
    roadWidthLabel: row["도로폭"],
    raw: row
  }));
}

function loadElderly(filePath) {
  const rows = readCsv(filePath, false);
  const dataRows = rows.slice(4);
  const list = dataRows
    .filter((row) => row[1] === "서대문구" && row[2] && row[2] !== "소계")
    .map((row) => {
      const total = numberFrom(row[3]);
      const elderlyPopulation = numberFrom(row[6]);
      return {
        dongName: row[2],
        totalPopulation: total,
        elderlyPopulation,
        elderlyRatio: total ? elderlyPopulation / total : 0
      };
    });

  const sortedByRatio = [...list].sort((a, b) => b.elderlyRatio - a.elderlyRatio);
  return list.map((row) => ({
    ...row,
    ratioRankPercent:
      sortedByRatio.findIndex((item) => item.dongName === row.dongName) / Math.max(sortedByRatio.length - 1, 1)
  }));
}

function loadExistingShades(filePath) {
  return readCsv(filePath)
    .map((row) => ({
      managementNo: row["관리번호"],
      name: row["설치장소명"],
      longitude: numberFrom(row["경도"]),
      latitude: numberFrom(row["위도"]),
      raw: row
    }))
    .filter((row) => inSeodaemun(row));
}

function loadSidewalks(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets["서대문구 시도 세부사항"];
  if (!sheet) return [];
  const geocodeCache = readGeocodeCache();

  return xlsx.utils
    .sheet_to_json(sheet, { defval: "" })
    .map((row) => {
      const range = String(row["구간(위치)"] || "");
      const [start, end] = range.split("~").map((value) => value?.trim()).filter(Boolean);
      const startAddress = normalizeAddress(start);
      const endAddress = normalizeAddress(end);
      const startPoint = geocodeCache.get(startAddress);
      const endPoint = geocodeCache.get(endAddress);
      const centerPoint = startPoint && endPoint
        ? {
            longitude: (startPoint.longitude + endPoint.longitude) / 2,
            latitude: (startPoint.latitude + endPoint.latitude) / 2
          }
        : null;
      return {
        routeName: String(row["노선명"] || routeNameFromAddress(range)),
        directionName: String(row["방향"] || ""),
        locationRange: range,
        startAddress,
        endAddress,
        widthM: numberFrom(row["폭(m)"]),
        lengthM: numberFrom(row["연장(m)"]),
        areaSqm: numberFrom(row["면적"]),
        serviceGrade: String(row["서비스등급"] || ""),
        blockType: String(row["블록 종류"] || ""),
        constructionYear: String(row["시공년도"] || ""),
        startLongitude: startPoint?.longitude ?? numberFrom(row["start_longitude"]),
        startLatitude: startPoint?.latitude ?? numberFrom(row["start_latitude"]),
        endLongitude: endPoint?.longitude ?? numberFrom(row["end_longitude"]),
        endLatitude: endPoint?.latitude ?? numberFrom(row["end_latitude"]),
        centerLongitude: centerPoint?.longitude ?? null,
        centerLatitude: centerPoint?.latitude ?? null,
        raw: row
      };
    })
    .filter((row) => row.routeName && Number.isFinite(row.widthM));
}

function readGeocodeCache() {
  const cachePath = path.resolve(config.projectRoot, "shade-priority-app", "server", "data", "sidewalk-geocodes.json");
  if (!fs.existsSync(cachePath)) return new Map();
  const rows = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  return new Map(
    rows
      .filter((row) => row.status === "ok" && Number.isFinite(row.longitude) && Number.isFinite(row.latitude))
      .map((row) => [row.address, { longitude: row.longitude, latitude: row.latitude }])
  );
}

function loadLegacyTop100(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const rows = readCsv(filePath);
  return new Map(
    rows.map((row) => [
      String(row["노드ID"]),
      {
        rank: numberFrom(row["순위"]),
        roadScore: numberFrom(row["도로점수"]),
        intersectionScore: numberFrom(row["교차로점수"]),
        crosswalkScore: numberFrom(row["대로변일치점수"]),
        elderlyScore: numberFrom(row["고령자점수"]),
        shelterScore: numberFrom(row["쉼터점수"])
      }
    ])
  );
}

function readCsv(filePath, columns = true) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const buffer = fs.readFileSync(filePath);
  let content = buffer.toString("utf8");
  if (content.includes("�")) {
    content = new TextDecoder("euc-kr").decode(buffer);
  }
  return parse(content, {
    columns,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true
  });
}

function findFile(dir, token) {
  if (!fs.existsSync(dir)) return "";
  const file = fs
    .readdirSync(dir)
    .find((name) => name.includes(token) && (name.endsWith(".csv") || name.endsWith(".xlsx")));
  return file ? path.resolve(dir, file) : "";
}

function findProjectFile(token, ext) {
  const file = fs
    .readdirSync(config.projectRoot)
    .find((name) => name.includes(token) && name.endsWith(ext));
  return file ? path.resolve(config.projectRoot, file) : "";
}

function normalizeAddress(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.startsWith("서울") ? text : `서울특별시 서대문구 ${text}`;
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function inSeodaemun(point) {
  return (
    Number.isFinite(point.longitude) &&
    Number.isFinite(point.latitude) &&
    point.longitude >= 126.89 &&
    point.longitude <= 126.98 &&
    point.latitude >= 37.54 &&
    point.latitude <= 37.61
  );
}
