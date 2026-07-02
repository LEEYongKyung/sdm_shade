import { loadLocalData } from "../services/dataStore.js";
import { query } from "../db/pool.js";

const data = loadLocalData();
const sourceRows = data.existingShades.filter((row) => row.managementNo);
const sourceManagementNos = new Set(sourceRows.map((row) => row.managementNo));

let inserted = 0;
let updated = 0;
let unchanged = 0;

await query("BEGIN");
try {
  for (const row of sourceRows) {
    const existing = await query(
      `SELECT id, admin_dong_name, name, road_address, lot_address,
              source_type, longitude, latitude, status
       FROM shade_facilities
       WHERE management_no = $1
         AND status = 'active'
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [row.managementNo]
    );

    if (!existing.rows[0]) {
      await insertShade(row);
      inserted += 1;
      continue;
    }

    if (sameShade(existing.rows[0], row)) {
      unchanged += 1;
      continue;
    }

    await updateShade(existing.rows[0].id, row);
    updated += 1;
  }

  const archived = await query(
    `UPDATE shade_facilities
     SET status = 'archived',
         updated_at = now()
     WHERE status = 'active'
       AND management_no IS NOT NULL
       AND trim(management_no) <> ''
       AND NOT (management_no = ANY($1::text[]))
     RETURNING management_no`,
    [[...sourceManagementNos]]
  );

  await query("COMMIT");
  console.log(JSON.stringify({
    sourceRows: sourceRows.length,
    inserted,
    updated,
    unchanged,
    archived: archived.rowCount
  }, null, 2));
} catch (error) {
  await query("ROLLBACK");
  throw error;
}

async function insertShade(row) {
  await query(
    `INSERT INTO shade_facilities
      (management_no, admin_dong_name, name, road_address, lot_address,
       source_type, longitude, latitude, geom, raw, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'existing', $6, $7,
       ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8::jsonb, 'active', now())`,
    [
      row.managementNo,
      row.adminDongName || "",
      row.name || "",
      row.roadAddress || "",
      row.lotAddress || "",
      row.longitude,
      row.latitude,
      JSON.stringify(row.raw || {})
    ]
  );
}

async function updateShade(id, row) {
  await query(
    `UPDATE shade_facilities
     SET admin_dong_name = $2,
         name = $3,
         road_address = $4,
         lot_address = $5,
         source_type = 'existing',
         longitude = $6,
         latitude = $7,
         geom = ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
         raw = $8::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      id,
      row.adminDongName || "",
      row.name || "",
      row.roadAddress || "",
      row.lotAddress || "",
      row.longitude,
      row.latitude,
      JSON.stringify(row.raw || {})
    ]
  );
}

function sameShade(existing, row) {
  return (
    text(existing.admin_dong_name) === text(row.adminDongName) &&
    text(existing.name) === text(row.name) &&
    text(existing.road_address) === text(row.roadAddress) &&
    text(existing.lot_address) === text(row.lotAddress) &&
    text(existing.source_type) === "existing" &&
    Number(existing.longitude) === Number(row.longitude) &&
    Number(existing.latitude) === Number(row.latitude)
  );
}

function text(value) {
  return String(value ?? "").trim();
}
