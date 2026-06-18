import { dbAvailable, query } from "../db/pool.js";
import { reverseGeocodePoint } from "./geocoding.js";

export async function loadCrosswalkContexts() {
  if (!(await dbAvailable())) return new Map();
  const result = await query(
    `SELECT *
     FROM crosswalk_contexts
     WHERE match_status = 'ok'`
  );
  return new Map(result.rows.map((row) => [row.node_id, toContext(row)]));
}

export async function syncCrosswalkContexts(crosswalks, options = {}) {
  if (!(await dbAvailable())) {
    throw new Error("DATABASE_URL is not configured or PostgreSQL is unavailable.");
  }

  const existing = options.refresh ? new Set() : await existingNodeIds();
  let skipped = 0;
  let synced = 0;
  let failed = 0;

  for (const crosswalk of crosswalks) {
    if (!crosswalk.nodeId || existing.has(crosswalk.nodeId)) {
      skipped += 1;
      continue;
    }

    try {
      const context = await reverseGeocodePoint({
        longitude: crosswalk.longitude,
        latitude: crosswalk.latitude
      });
      await upsertContext(crosswalk, context);
      synced += 1;
      await delay(options.delayMs ?? 80);
    } catch (error) {
      await upsertError(crosswalk, error);
      failed += 1;
    }
  }

  return {
    total: crosswalks.length,
    synced,
    skipped,
    failed
  };
}

async function existingNodeIds() {
  const result = await query(`SELECT node_id FROM crosswalk_contexts WHERE match_status = 'ok'`);
  return new Set(result.rows.map((row) => row.node_id));
}

async function upsertContext(crosswalk, context) {
  await query(
    `INSERT INTO crosswalk_contexts
      (node_id, longitude, latitude, road_address, parcel_address, road_name, road_code,
       legal_dong_name, legal_dong_code, admin_dong_name, admin_dong_code,
       match_status, confidence, raw, fetched_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, now(), now())
     ON CONFLICT (node_id) DO UPDATE SET
       longitude = EXCLUDED.longitude,
       latitude = EXCLUDED.latitude,
       road_address = EXCLUDED.road_address,
       parcel_address = EXCLUDED.parcel_address,
       road_name = EXCLUDED.road_name,
       road_code = EXCLUDED.road_code,
       legal_dong_name = EXCLUDED.legal_dong_name,
       legal_dong_code = EXCLUDED.legal_dong_code,
       admin_dong_name = EXCLUDED.admin_dong_name,
       admin_dong_code = EXCLUDED.admin_dong_code,
       match_status = EXCLUDED.match_status,
       confidence = EXCLUDED.confidence,
       raw = EXCLUDED.raw,
       fetched_at = now(),
       updated_at = now()`,
    [
      crosswalk.nodeId,
      crosswalk.longitude,
      crosswalk.latitude,
      context.roadAddress || "",
      context.parcelAddress || "",
      context.roadName || "",
      context.roadCode || "",
      context.legalDongName || "",
      context.legalDongCode || "",
      context.adminDongName || "",
      context.adminDongCode || "",
      context.status,
      context.confidence,
      JSON.stringify(context.raw || {})
    ]
  );
}

async function upsertError(crosswalk, error) {
  await query(
    `INSERT INTO crosswalk_contexts
      (node_id, longitude, latitude, match_status, confidence, raw, fetched_at, updated_at)
     VALUES ($1, $2, $3, 'error', 'NONE', $4::jsonb, now(), now())
     ON CONFLICT (node_id) DO UPDATE SET
       longitude = EXCLUDED.longitude,
       latitude = EXCLUDED.latitude,
       match_status = 'error',
       confidence = 'NONE',
       raw = EXCLUDED.raw,
       fetched_at = now(),
       updated_at = now()`,
    [
      crosswalk.nodeId,
      crosswalk.longitude,
      crosswalk.latitude,
      JSON.stringify({ error: error.message })
    ]
  );
}

function toContext(row) {
  return {
    nodeId: row.node_id,
    roadAddress: row.road_address || "",
    parcelAddress: row.parcel_address || "",
    roadName: row.road_name || "",
    roadCode: row.road_code || "",
    legalDongName: row.legal_dong_name || "",
    legalDongCode: row.legal_dong_code || "",
    adminDongName: row.admin_dong_name || "",
    adminDongCode: row.admin_dong_code || "",
    confidence: row.confidence || "NONE"
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
