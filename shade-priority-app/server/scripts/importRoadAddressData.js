import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { config } from "../config.js";
import { query } from "../db/pool.js";

const SIG_CD_SEODAEMUN = "11410";
const decoder = new TextDecoder("euc-kr");

await importRoadSegments();
await importRoadWidthPolygons();
process.exit(0);

async function importRoadSegments() {
  const basePath = path.resolve(config.roadAddressSegmentDir, "TL_SPRD_MANAGE_11_202606");
  const files = shapefileSet(basePath);
  assertShapefile(files, "road address segment");

  await query("TRUNCATE road_address_segments RESTART IDENTITY");

  const shx = fs.readFileSync(files.shx);
  const shp = fs.openSync(files.shp, "r");
  const dbf = openDbf(files.dbf);
  const recordCount = (shx.length - 100) / 8;
  const batch = [];
  let importedCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < recordCount; index += 1) {
    const attrs = readDbfRecord(dbf, index);
    if (attrs.SIG_CD !== SIG_CD_SEODAEMUN) {
      skippedCount += 1;
      continue;
    }

    const offset = shx.readInt32BE(100 + index * 8) * 2;
    const shape = readPolyline(shp, offset);
    const wkt = lineWkt(shape?.parts);
    if (!shape || !wkt || !attrs.RDS_MAN_NO) {
      skippedCount += 1;
      continue;
    }

    batch.push([
      attrs.SIG_CD,
      numberFrom(attrs.RDS_MAN_NO),
      attrs.RN || null,
      attrs.RN_CD || null,
      attrs.ENG_RN || null,
      attrs.ROA_CLS_SE || null,
      attrs.RDS_DPN_SE || null,
      numberFrom(attrs.ROAD_BT),
      numberFrom(attrs.ROAD_LT),
      attrs.RBP_CN || null,
      attrs.REP_CN || null,
      attrs.NTFC_DE || null,
      attrs.OPERT_DE || null,
      wkt,
      JSON.stringify(attrs)
    ]);

    if (batch.length >= 500) {
      importedCount += await insertRoadSegmentBatch(batch);
      batch.length = 0;
      process.stdout.write(`Imported ${importedCount.toLocaleString()} road segments\r`);
    }
  }

  if (batch.length) importedCount += await insertRoadSegmentBatch(batch);
  fs.closeSync(shp);
  fs.closeSync(dbf.fd);
  process.stdout.write("\n");
  console.log({
    dataset: "road_address_segments",
    sourceDir: config.roadAddressSegmentDir,
    importedCount,
    skippedCount
  });
}

async function importRoadWidthPolygons() {
  const basePath = path.resolve(config.roadWidthPolygonDir, "TL_SPRD_RW_11_202606");
  const files = shapefileSet(basePath);
  assertShapefile(files, "road width polygon");

  await query("TRUNCATE road_width_polygons RESTART IDENTITY");

  const shx = fs.readFileSync(files.shx);
  const shp = fs.openSync(files.shp, "r");
  const dbf = openDbf(files.dbf);
  const recordCount = (shx.length - 100) / 8;
  const batch = [];
  let importedCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < recordCount; index += 1) {
    const attrs = readDbfRecord(dbf, index);
    if (attrs.SIG_CD !== SIG_CD_SEODAEMUN) {
      skippedCount += 1;
      continue;
    }

    const offset = shx.readInt32BE(100 + index * 8) * 2;
    const shape = readPolygon(shp, offset);
    const wkt = polygonWkt(shape?.rings);
    if (!shape || !wkt || !attrs.RW_SN) {
      skippedCount += 1;
      continue;
    }

    batch.push([
      attrs.SIG_CD,
      numberFrom(attrs.RW_SN),
      attrs.OPERT_DE || null,
      wkt,
      JSON.stringify(attrs)
    ]);

    if (batch.length >= 500) {
      importedCount += await insertRoadWidthPolygonBatch(batch);
      batch.length = 0;
      process.stdout.write(`Imported ${importedCount.toLocaleString()} road width polygons\r`);
    }
  }

  if (batch.length) importedCount += await insertRoadWidthPolygonBatch(batch);
  fs.closeSync(shp);
  fs.closeSync(dbf.fd);
  process.stdout.write("\n");
  console.log({
    dataset: "road_width_polygons",
    sourceDir: config.roadWidthPolygonDir,
    importedCount,
    skippedCount
  });
}

async function insertRoadSegmentBatch(rows) {
  const values = [];
  const params = [];
  rows.forEach((row, index) => {
    const offset = index * 15;
    values.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, ST_MakeValid(ST_GeomFromText($${offset + 14}, 5179)), $${offset + 15}::jsonb)`
    );
    params.push(...row);
  });

  await query(
    `INSERT INTO road_address_segments
      (sig_cd, rds_man_no, road_name, road_name_code, english_road_name, road_class_code,
       dependent_section_code, road_width_m, road_length_m, start_location, end_location,
       announced_date, operation_date, geom, raw)
     VALUES ${values.join(",")}
     ON CONFLICT (sig_cd, rds_man_no) DO UPDATE SET
      road_name = EXCLUDED.road_name,
      road_name_code = EXCLUDED.road_name_code,
      english_road_name = EXCLUDED.english_road_name,
      road_class_code = EXCLUDED.road_class_code,
      dependent_section_code = EXCLUDED.dependent_section_code,
      road_width_m = EXCLUDED.road_width_m,
      road_length_m = EXCLUDED.road_length_m,
      start_location = EXCLUDED.start_location,
      end_location = EXCLUDED.end_location,
      announced_date = EXCLUDED.announced_date,
      operation_date = EXCLUDED.operation_date,
      geom = EXCLUDED.geom,
      raw = EXCLUDED.raw,
      updated_at = now()`,
    params
  );
  return rows.length;
}

async function insertRoadWidthPolygonBatch(rows) {
  const values = [];
  const params = [];
  rows.forEach((row, index) => {
    const offset = index * 5;
    values.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, ST_MakeValid(ST_GeomFromText($${offset + 4}, 5179)), $${offset + 5}::jsonb)`
    );
    params.push(...row);
  });

  await query(
    `INSERT INTO road_width_polygons
      (sig_cd, rw_sn, operation_date, geom, raw)
     VALUES ${values.join(",")}
     ON CONFLICT (sig_cd, rw_sn) DO UPDATE SET
      operation_date = EXCLUDED.operation_date,
      geom = EXCLUDED.geom,
      raw = EXCLUDED.raw,
      updated_at = now()`,
    params
  );
  return rows.length;
}

function shapefileSet(basePath) {
  return {
    shp: `${basePath}.shp`,
    shx: `${basePath}.shx`,
    dbf: `${basePath}.dbf`
  };
}

function assertShapefile(files, label) {
  if (!fs.existsSync(files.shp) || !fs.existsSync(files.shx) || !fs.existsSync(files.dbf)) {
    throw new Error(`${label} shapefile set not found.`);
  }
}

function readPolyline(fd, offset) {
  const header = Buffer.alloc(52);
  fs.readSync(fd, header, 0, header.length, offset + 8);
  const shapeType = header.readInt32LE(0);
  if (shapeType !== 3) return null;

  const partCount = header.readInt32LE(36);
  const pointCount = header.readInt32LE(40);
  if (partCount < 1 || pointCount < 2) return null;

  const body = Buffer.alloc(44 + partCount * 4 + pointCount * 16);
  fs.readSync(fd, body, 0, body.length, offset + 8);
  const starts = [];
  for (let i = 0; i < partCount; i += 1) starts.push(body.readInt32LE(44 + i * 4));
  const pointStart = 44 + partCount * 4;
  return {
    parts: starts.map((start, partIndex) => {
      const end = partIndex + 1 < starts.length ? starts[partIndex + 1] : pointCount;
      const points = [];
      for (let i = start; i < end; i += 1) {
        points.push([
          body.readDoubleLE(pointStart + i * 16),
          body.readDoubleLE(pointStart + i * 16 + 8)
        ]);
      }
      return points;
    })
  };
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

function cleanText(value) {
  return String(value || "").replace(/\0/g, "").trim();
}

function lineWkt(parts = []) {
  const validParts = parts.filter((part) => part.length >= 2);
  if (!validParts.length) return "";
  if (validParts.length === 1) return `LINESTRING(${coordinatesWkt(validParts[0])})`;
  return `MULTILINESTRING(${validParts.map((part) => `(${coordinatesWkt(part)})`).join(",")})`;
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

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
