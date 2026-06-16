import { config } from "../config.js";
import { query } from "../db/pool.js";
import { epsg5186ToWgs84, parseWktPoint } from "./geo.js";

const datasets = {
  crosswalk: {
    label: "crosswalk",
    service: process.env.SEOUL_CROSSWALK_SERVICE || "tbTraficCrsng",
    key: process.env.SEOUL_CROSSWALK_API_KEY,
    table: "crosswalks"
  },
  cooling_shelter: {
    label: "cooling_shelter",
    service: process.env.SEOUL_COOLING_SHELTER_SERVICE || "TbGtnHwcwP",
    key: process.env.SEOUL_COOLING_SHELTER_API_KEY,
    table: "cooling_shelters"
  },
  intersection: {
    label: "intersection",
    service: process.env.SEOUL_INTERSECTION_SERVICE || "trafficSafetyA008PInfo",
    key: process.env.SEOUL_INTERSECTION_API_KEY,
    table: "intersections"
  },
  road_route: {
    label: "road_route",
    service: process.env.SEOUL_ROAD_ROUTE_SERVICE || "viRoutDt",
    key: process.env.SEOUL_ROAD_ROUTE_API_KEY,
    table: "road_routes"
  }
};

export function syncDatasetIds() {
  return Object.keys(datasets);
}

export async function syncOpenApiDataset(datasetId, actor = "system") {
  const dataset = datasets[datasetId];
  if (!dataset) throw new Error(`Unknown dataset: ${datasetId}`);
  if (!dataset.key) throw new Error(`API key is missing for ${datasetId}`);

  const run = await query(
    `INSERT INTO data_sync_runs (dataset, service_name, status, triggered_by)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [dataset.label, dataset.service, actor]
  );
  const runId = run.rows[0].id;

  try {
    const rows = await fetchAllRows(dataset);
    const seenKeys = [];
    let upsertedCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      try {
        const sourceKey = await upsertRow(datasetId, row);
        if (sourceKey) {
          seenKeys.push(sourceKey);
          upsertedCount += 1;
        }
      } catch (error) {
        errorCount += 1;
        await query(
          `INSERT INTO data_sync_errors (sync_run_id, dataset, source_key, error_message, raw)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [runId, dataset.label, sourceKeyFor(datasetId, row), error.message, JSON.stringify(row)]
        );
      }
    }

    const deactivatedCount = await deactivateMissing(dataset.table, seenKeys);
    await query(
      `UPDATE data_sync_runs
       SET status = $2,
           finished_at = now(),
           fetched_count = $3,
           upserted_count = $4,
           deactivated_count = $5,
           error_count = $6,
           message = $7,
           raw_summary = $8::jsonb
       WHERE id = $1`,
      [
        runId,
        errorCount ? "completed_with_errors" : "completed",
        rows.length,
        upsertedCount,
        deactivatedCount,
        errorCount,
        errorCount ? "Some rows failed to sync." : "Sync completed.",
        JSON.stringify({ seenCount: seenKeys.length })
      ]
    );
    await audit(actor, "data_sync", "data_sync_runs", String(runId), {
      dataset: dataset.label,
      fetchedCount: rows.length,
      upsertedCount,
      deactivatedCount,
      errorCount
    });

    return getSyncRun(runId);
  } catch (error) {
    await query(
      `UPDATE data_sync_runs
       SET status = 'failed', finished_at = now(), message = $2
       WHERE id = $1`,
      [runId, error.message]
    );
    await audit(actor, "data_sync_failed", "data_sync_runs", String(runId), {
      dataset: dataset.label,
      error: error.message
    });
    throw error;
  }
}

export async function syncAllOpenApiDatasets(actor = "system") {
  const results = [];
  for (const id of syncDatasetIds()) {
    results.push(await syncOpenApiDataset(id, actor));
  }
  return results;
}

export async function recentSyncRuns(limit = 20) {
  const result = await query(
    `SELECT *
     FROM data_sync_runs
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function fetchAllRows(dataset) {
  const first = await fetchPage(dataset, 1, 1);
  const root = first[dataset.service];
  if (!root?.RESULT || root.RESULT.CODE !== "INFO-000") {
    throw new Error(`OpenAPI failed: ${JSON.stringify(root?.RESULT || first)}`);
  }

  const total = Number(root.list_total_count || 0);
  const rows = [];
  const pageSize = 1000;
  for (let start = 1; start <= total; start += pageSize) {
    const end = Math.min(start + pageSize - 1, total);
    const payload = await fetchPage(dataset, start, end);
    rows.push(...array(payload[dataset.service]?.row));
  }
  return rows;
}

async function fetchPage(dataset, start, end) {
  const url = `http://openapi.seoul.go.kr:8088/${dataset.key}/json/${dataset.service}/${start}/${end}/`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${dataset.label}`);
  }
  return response.json();
}

async function upsertRow(datasetId, row) {
  if (datasetId === "crosswalk") return upsertCrosswalk(row);
  if (datasetId === "cooling_shelter") return upsertCoolingShelter(row);
  if (datasetId === "intersection") return upsertIntersection(row);
  if (datasetId === "road_route") return upsertRoadRoute(row);
  throw new Error(`Unsupported dataset: ${datasetId}`);
}

async function upsertCrosswalk(row) {
  const sourceKey = sourceKeyFor("crosswalk", row);
  const point = parseWktPoint(row.NODE_WKT);
  if (!sourceKey || !point) throw new Error("Missing crosswalk key or point.");
  await query(
    `INSERT INTO crosswalks
      (node_id, node_type, district_code, district_name, dong_code, dong_name,
       longitude, latitude, source_key, source_origin, is_active, last_seen_at, updated_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $1, 'openapi', true, now(), now(), $9::jsonb)
     ON CONFLICT (node_id) DO UPDATE SET
      node_type = EXCLUDED.node_type,
      district_code = EXCLUDED.district_code,
      district_name = EXCLUDED.district_name,
      dong_code = EXCLUDED.dong_code,
      dong_name = EXCLUDED.dong_name,
      longitude = EXCLUDED.longitude,
      latitude = EXCLUDED.latitude,
      source_key = EXCLUDED.source_key,
      source_origin = 'openapi',
      is_active = true,
      last_seen_at = now(),
      updated_at = now(),
      raw = EXCLUDED.raw`,
    [
      sourceKey,
      row.NODE_TYPE,
      row.SGG_CD,
      row.SGG_NM,
      row.EMD_CD,
      row.EMD_NM,
      point.longitude,
      point.latitude,
      JSON.stringify(row)
    ]
  );
  return sourceKey;
}

async function upsertCoolingShelter(row) {
  const sourceKey = sourceKeyFor("cooling_shelter", row);
  const longitude = numberFrom(row.LOT ?? row.LON ?? row.LNG ?? row.longitude);
  const latitude = numberFrom(row.LAT ?? row.latitude);
  if (!sourceKey) throw new Error("Missing cooling shelter key.");
  await query(
    `INSERT INTO cooling_shelters
      (facility_year, name, road_address, lot_address, capacity, longitude, latitude, geom,
       source_key, source_origin, is_active, last_seen_at, updated_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
       CASE WHEN $6 IS NULL OR $7 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography END,
       $8, 'openapi', true, now(), now(), $9::jsonb)
     ON CONFLICT (source_key) DO UPDATE SET
      facility_year = EXCLUDED.facility_year,
      name = EXCLUDED.name,
      road_address = EXCLUDED.road_address,
      lot_address = EXCLUDED.lot_address,
      capacity = EXCLUDED.capacity,
      longitude = EXCLUDED.longitude,
      latitude = EXCLUDED.latitude,
      geom = EXCLUDED.geom,
      source_origin = 'openapi',
      is_active = true,
      last_seen_at = now(),
      updated_at = now(),
      raw = EXCLUDED.raw`,
    [
      numberFrom(row.FCLTY_YR ?? row.YEAR),
      row.R_AREA_NM ?? row.AREA_NM ?? "",
      row.R_DETL_ADD ?? "",
      row.LOTNO_ADDR ?? "",
      numberFrom(row.USE_PSBL_NMPR ?? row.CAPACITY),
      longitude,
      latitude,
      sourceKey,
      JSON.stringify(row)
    ]
  );
  return sourceKey;
}

async function upsertIntersection(row) {
  const sourceKey = sourceKeyFor("intersection", row);
  const point = epsg5186ToWgs84(row.X ?? row.X_CRD ?? row.X_COORD, row.Y ?? row.Y_CRD ?? row.Y_COORD);
  if (!sourceKey) throw new Error("Missing intersection key.");
  await query(
    `INSERT INTO intersections
      (intersection_code, name, longitude, latitude, geom,
       source_key, source_origin, is_active, last_seen_at, updated_at, raw)
     VALUES ($1, $2, $3, $4,
       CASE WHEN $3 IS NULL OR $4 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography END,
       $1, 'openapi', true, now(), now(), $5::jsonb)
     ON CONFLICT (intersection_code) DO UPDATE SET
      name = EXCLUDED.name,
      longitude = EXCLUDED.longitude,
      latitude = EXCLUDED.latitude,
      geom = EXCLUDED.geom,
      source_key = EXCLUDED.source_key,
      source_origin = 'openapi',
      is_active = true,
      last_seen_at = now(),
      updated_at = now(),
      raw = EXCLUDED.raw`,
    [sourceKey, row.INTR_NM ?? row.INTERSECTION_NM ?? "", point?.longitude ?? null, point?.latitude ?? null, JSON.stringify(row)]
  );
  return sourceKey;
}

async function upsertRoadRoute(row) {
  const sourceKey = sourceKeyFor("road_route", row);
  if (!sourceKey) throw new Error("Missing road route key.");
  await query(
    `INSERT INTO road_routes
      (route_name, road_type, road_function, road_scale, road_width_label,
       source_key, source_origin, is_active, last_seen_at, updated_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, 'openapi', true, now(), now(), $7::jsonb)
     ON CONFLICT (source_key) DO UPDATE SET
      route_name = EXCLUDED.route_name,
      road_type = EXCLUDED.road_type,
      road_function = EXCLUDED.road_function,
      road_scale = EXCLUDED.road_scale,
      road_width_label = EXCLUDED.road_width_label,
      source_origin = 'openapi',
      is_active = true,
      last_seen_at = now(),
      updated_at = now(),
      raw = EXCLUDED.raw`,
    [
      row.ROD_NAM ?? "",
      row.ROAD_TYPE ?? "",
      row.ROAD_FUNC ?? "",
      row.ROAD_SCALE ?? "",
      row.ROAD_WIDTH ?? "",
      sourceKey,
      JSON.stringify(row)
    ]
  );
  return sourceKey;
}

async function deactivateMissing(table, seenKeys) {
  if (!seenKeys.length) return 0;
  const result = await query(
    `UPDATE ${table}
     SET is_active = false, updated_at = now()
     WHERE source_origin = 'openapi'
       AND source_key IS NOT NULL
       AND NOT (source_key = ANY($1::text[]))`,
    [seenKeys]
  );
  return result.rowCount || 0;
}

async function getSyncRun(id) {
  const result = await query(`SELECT * FROM data_sync_runs WHERE id = $1`, [id]);
  return result.rows[0];
}

async function audit(actor, action, entityType, entityId, detail) {
  await query(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actor, action, entityType, entityId, JSON.stringify(detail)]
  );
}

function sourceKeyFor(datasetId, row) {
  if (datasetId === "crosswalk") return String(row.NODE_ID ?? "").trim();
  if (datasetId === "cooling_shelter") {
    return [row.R_AREA_NM, row.R_DETL_ADD || row.LOTNO_ADDR].map((value) => String(value ?? "").trim()).filter(Boolean).join(" | ");
  }
  if (datasetId === "intersection") return String(row.INTR_CD ?? "").trim();
  if (datasetId === "road_route") {
    return [row.ROAD_TYPE, row.ROAD_FUNC, row.ROAD_SCALE, row.ROAD_WIDTH, row.ROD_NAM]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" | ");
  }
  return "";
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
