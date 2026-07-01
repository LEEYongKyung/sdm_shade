import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { config } from "../config.js";
import { query } from "../db/pool.js";

const SIG_CD_SEODAEMUN = "11410";
const decoder = new TextDecoder("euc-kr");
const basePath = path.resolve(config.legalDongBoundaryDir, "LSMD_ADM_SECT_UMD_11_202606");
const files = {
  shp: `${basePath}.shp`,
  shx: `${basePath}.shx`,
  dbf: `${basePath}.dbf`
};

if (!fs.existsSync(files.shp) || !fs.existsSync(files.shx) || !fs.existsSync(files.dbf)) {
  throw new Error(`Legal dong boundary shapefile set not found at ${config.legalDongBoundaryDir}`);
}

await query("TRUNCATE legal_dong_boundaries RESTART IDENTITY");

const shx = fs.readFileSync(files.shx);
const shp = fs.openSync(files.shp, "r");
const dbf = openDbf(files.dbf);
const recordCount = (shx.length - 100) / 8;
const batch = [];
let importedCount = 0;
let skippedCount = 0;

for (let index = 0; index < recordCount; index += 1) {
  const attrs = readDbfRecord(dbf, index);
  if (attrs.COL_ADM_SE !== SIG_CD_SEODAEMUN) {
    skippedCount += 1;
    continue;
  }

  const offset = shx.readInt32BE(100 + index * 8) * 2;
  const shape = readPolygon(shp, offset);
  const wkt = polygonWkt(shape?.rings);
  if (!shape || !wkt || !attrs.EMD_CD || !attrs.EMD_NM) {
    skippedCount += 1;
    continue;
  }

  batch.push([
    attrs.EMD_CD,
    attrs.COL_ADM_SE,
    attrs.EMD_NM,
    numberFrom(attrs.SGG_OID),
    wkt,
    JSON.stringify(attrs)
  ]);
}

if (batch.length) importedCount += await insertBatch(batch);

fs.closeSync(shp);
fs.closeSync(dbf.fd);

console.log({
  sourceDir: config.legalDongBoundaryDir,
  importedCount,
  skippedCount
});

async function insertBatch(rows) {
  const values = [];
  const params = [];
  rows.forEach((row, index) => {
    const offset = index * 6;
    values.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, ST_MakeValid(ST_GeomFromText($${offset + 5}, 5186)), $${offset + 6}::jsonb)`
    );
    params.push(...row);
  });

  await query(
    `INSERT INTO legal_dong_boundaries
      (emd_cd, sig_cd, emd_name, sgg_oid, geom, raw)
     VALUES ${values.join(",")}
     ON CONFLICT (emd_cd) DO UPDATE SET
      sig_cd = EXCLUDED.sig_cd,
      emd_name = EXCLUDED.emd_name,
      sgg_oid = EXCLUDED.sgg_oid,
      geom = EXCLUDED.geom,
      raw = EXCLUDED.raw,
      updated_at = now()`,
    params
  );
  return rows.length;
}

function readPolygon(fd, offset) {
  const header = Buffer.alloc(52);
  fs.readSync(fd, header, 0, header.length, offset + 8);
  const shapeType = header.readInt32LE(0);
  if (shapeType !== 5) return null;

  const partCount = header.readInt32LE(36);
  const pointCount = header.readInt32LE(40);
  if (partCount < 1 || pointCount < 4) return null;

  const body = Buffer.alloc(44 + partCount * 4 + pointCount * 16);
  fs.readSync(fd, body, 0, body.length, offset + 8);
  const starts = [];
  for (let i = 0; i < partCount; i += 1) starts.push(body.readInt32LE(44 + i * 4));
  const pointStart = 44 + partCount * 4;
  return {
    rings: starts.map((start, ringIndex) => {
      const end = ringIndex + 1 < starts.length ? starts[ringIndex + 1] : pointCount;
      const points = [];
      for (let i = start; i < end; i += 1) {
        points.push([
          body.readDoubleLE(pointStart + i * 16),
          body.readDoubleLE(pointStart + i * 16 + 8)
        ]);
      }
      return closeRing(points);
    }).filter((ring) => ring.length >= 4)
  };
}

function openDbf(filePath) {
  const fd = fs.openSync(filePath, "r");
  const header = Buffer.alloc(32);
  fs.readSync(fd, header, 0, header.length, 0);
  const headerLength = header.readUInt16LE(8);
  const recordLength = header.readUInt16LE(10);
  const fieldBuffer = Buffer.alloc(headerLength - 33);
  fs.readSync(fd, fieldBuffer, 0, fieldBuffer.length, 32);

  const fields = [];
  let position = 1;
  for (let offset = 0; offset < fieldBuffer.length; offset += 32) {
    const field = fieldBuffer.subarray(offset, offset + 32);
    if (field[0] === 0x0d) break;
    const length = field[16];
    fields.push({
      name: field.subarray(0, 11).toString("ascii").replace(/\0.*$/, ""),
      type: String.fromCharCode(field[11]),
      length,
      position
    });
    position += length;
  }

  return { fd, headerLength, recordLength, fields };
}

function readDbfRecord(dbf, index) {
  const record = Buffer.alloc(dbf.recordLength);
  fs.readSync(dbf.fd, record, 0, dbf.recordLength, dbf.headerLength + index * dbf.recordLength);
  const row = {};
  for (const field of dbf.fields) {
    const raw = record.subarray(field.position, field.position + field.length);
    const text = cleanText(decoder.decode(raw));
    row[field.name] = field.type === "N" ? String(numberFrom(text) ?? "") : text;
  }
  return row;
}

function polygonWkt(rings = []) {
  if (!rings.length) return "";
  return `POLYGON(${rings.map((ring) => `(${coordinatesWkt(ring)})`).join(",")})`;
}

function coordinatesWkt(points) {
  return points.map(([x, y]) => `${x} ${y}`).join(",");
}

function closeRing(points) {
  if (!points.length) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

function cleanText(value) {
  return String(value || "").replace(/\0/g, "").trim();
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
