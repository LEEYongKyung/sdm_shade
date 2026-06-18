import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { query } from "../db/pool.js";

const basePath = path.resolve(config.ngiiSidewalkDir, "N3L_A0033320");
const shpPath = `${basePath}.shp`;
const shxPath = `${basePath}.shx`;
const dbfPath = `${basePath}.dbf`;
const seodaemunBbox5179 = {
  xmin: 946000,
  ymin: 1948900,
  xmax: 954300,
  ymax: 1957100
};

if (!fs.existsSync(shpPath) || !fs.existsSync(shxPath) || !fs.existsSync(dbfPath)) {
  throw new Error(`NGII sidewalk shapefile set not found at ${config.ngiiSidewalkDir}`);
}

await query("TRUNCATE ngii_sidewalk_lines RESTART IDENTITY");

const shx = fs.readFileSync(shxPath);
const shp = fs.openSync(shpPath, "r");
const dbf = openDbf(dbfPath);
const recordCount = (shx.length - 100) / 8;
const batch = [];
let scannedCount = 0;
let skippedCount = 0;
let importedCount = 0;

for (let index = 0; index < recordCount; index += 1) {
  scannedCount += 1;
  const offset = shx.readInt32BE(100 + index * 8) * 2;
  const shape = readPolyline(shp, offset);
  if (!shape || !bboxIntersects(shape.bbox, seodaemunBbox5179)) {
    skippedCount += 1;
    continue;
  }

  const attrs = readDbfRecord(dbf, index);
  if (attrs.KIND !== "SWK001") {
    skippedCount += 1;
    continue;
  }

  const widthM = numberFrom(attrs.WIDT);
  const wkt = lineWkt(shape.points);
  if (!attrs.UFID || !wkt) {
    skippedCount += 1;
    continue;
  }

  batch.push([
    attrs.UFID,
    widthM,
    attrs.QUAL || null,
    attrs.BYYN || null,
    attrs.KIND || null,
    attrs.SCLS || null,
    attrs.FMTA || null,
    wkt,
    JSON.stringify(attrs)
  ]);

  if (batch.length >= 1000) {
    importedCount += await insertBatch(batch);
    batch.length = 0;
    process.stdout.write(`Imported ${importedCount.toLocaleString()} sidewalk lines\r`);
  }
}

if (batch.length) {
  importedCount += await insertBatch(batch);
}

fs.closeSync(shp);
fs.closeSync(dbf.fd);
process.stdout.write("\n");
console.log({
  sourceDir: config.ngiiSidewalkDir,
  scannedCount,
  importedCount,
  skippedCount
});

async function insertBatch(rows) {
  const values = [];
  const params = [];
  rows.forEach((row, rowIndex) => {
    const offset = rowIndex * 9;
    values.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, ST_GeomFromText($${offset + 8}, 5179), $${offset + 9}::jsonb)`
    );
    params.push(...row);
  });

  await query(
    `INSERT INTO ngii_sidewalk_lines
      (ufid, width_m, material_code, bicycle_yn_code, kind_code, integrated_code, production_info, geom, raw)
     VALUES ${values.join(",")}
     ON CONFLICT (ufid) DO UPDATE SET
      width_m = EXCLUDED.width_m,
      material_code = EXCLUDED.material_code,
      bicycle_yn_code = EXCLUDED.bicycle_yn_code,
      kind_code = EXCLUDED.kind_code,
      integrated_code = EXCLUDED.integrated_code,
      production_info = EXCLUDED.production_info,
      geom = EXCLUDED.geom,
      raw = EXCLUDED.raw,
      updated_at = now()`,
    params
  );
  return rows.length;
}

function readPolyline(fd, offset) {
  const header = Buffer.alloc(52);
  fs.readSync(fd, header, 0, header.length, offset + 8);
  const shapeType = header.readInt32LE(0);
  if (shapeType !== 3) return null;

  const bbox = {
    xmin: header.readDoubleLE(4),
    ymin: header.readDoubleLE(12),
    xmax: header.readDoubleLE(20),
    ymax: header.readDoubleLE(28)
  };
  const partCount = header.readInt32LE(36);
  const pointCount = header.readInt32LE(40);
  if (partCount !== 1 || pointCount < 2) return null;

  const body = Buffer.alloc(44 + partCount * 4 + pointCount * 16);
  fs.readSync(fd, body, 0, body.length, offset + 8);
  const pointStart = 44 + partCount * 4;
  const points = [];
  for (let i = 0; i < pointCount; i += 1) {
    points.push([
      body.readDoubleLE(pointStart + i * 16),
      body.readDoubleLE(pointStart + i * 16 + 8)
    ]);
  }
  return { bbox, points };
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
  for (let offset = 0; offset < fieldBuffer.length; offset += 32) {
    const field = fieldBuffer.subarray(offset, offset + 32);
    if (field[0] === 0x0d) break;
    fields.push({
      name: field.subarray(0, 11).toString("ascii").replace(/\0.*$/, ""),
      length: field[16]
    });
  }

  return { fd, headerLength, recordLength, fields };
}

function readDbfRecord(dbf, index) {
  const record = Buffer.alloc(dbf.recordLength);
  fs.readSync(dbf.fd, record, 0, dbf.recordLength, dbf.headerLength + index * dbf.recordLength);
  let position = 1;
  const row = {};
  for (const field of dbf.fields) {
    row[field.name] = record.subarray(position, position + field.length).toString("latin1").trim();
    position += field.length;
  }
  return row;
}

function bboxIntersects(a, b) {
  return a.xmax >= b.xmin && a.xmin <= b.xmax && a.ymax >= b.ymin && a.ymin <= b.ymax;
}

function lineWkt(points) {
  if (!points.length) return "";
  return `LINESTRING(${points.map(([x, y]) => `${x} ${y}`).join(",")})`;
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
