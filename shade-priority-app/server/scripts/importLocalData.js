import { loadLocalData } from "../services/dataStore.js";
import { query } from "../db/pool.js";
import { scoringRules } from "../services/rules.js";

const data = loadLocalData();

for (const rule of scoringRules) {
  await query(
    `INSERT INTO scoring_rules
      (id, label, description, max_score, category, is_enabled, is_locked, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      max_score = EXCLUDED.max_score,
      category = EXCLUDED.category,
      is_enabled = EXCLUDED.is_enabled,
      is_locked = EXCLUDED.is_locked,
      sort_order = EXCLUDED.sort_order`,
    [rule.id, rule.label, rule.description, rule.maxScore, rule.category, rule.enabled, rule.locked, rule.sortOrder]
  );
}

for (const row of data.crosswalks) {
  await query(
    `INSERT INTO crosswalks
      (node_id, district_name, dong_name, longitude, latitude, raw)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (node_id) DO UPDATE SET
      district_name = EXCLUDED.district_name,
      dong_name = EXCLUDED.dong_name,
      longitude = EXCLUDED.longitude,
      latitude = EXCLUDED.latitude,
      raw = EXCLUDED.raw`,
    [row.nodeId, row.districtName, row.dongName, row.longitude, row.latitude, JSON.stringify(row.raw)]
  );
}

for (const row of data.shelters) {
  await query(
    `INSERT INTO cooling_shelters
      (name, road_address, longitude, latitude, geom, raw)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5::jsonb)`,
    [row.name, row.roadAddress, row.longitude, row.latitude, JSON.stringify(row.raw)]
  );
}

for (const row of data.intersections) {
  await query(
    `INSERT INTO intersections
      (intersection_code, name, longitude, latitude, geom, raw)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5::jsonb)
     ON CONFLICT (intersection_code) DO UPDATE SET
      name = EXCLUDED.name,
      longitude = EXCLUDED.longitude,
      latitude = EXCLUDED.latitude,
      geom = EXCLUDED.geom,
      raw = EXCLUDED.raw`,
    [row.code, row.name, row.longitude, row.latitude, JSON.stringify(row.raw)]
  );
}

for (const row of data.roads) {
  await query(
    `INSERT INTO road_routes
      (route_name, road_type, road_function, road_scale, road_width_label, raw)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [row.routeName, row.roadType, row.roadFunction, row.roadScale, row.roadWidthLabel, JSON.stringify(row.raw)]
  );
}

for (const row of data.elderly) {
  await query(
    `INSERT INTO elderly_population
      (year_quarter, dong_name, total_population, elderly_population, elderly_ratio, raw)
     VALUES ('2026 1/4', $1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (year_quarter, dong_name) DO UPDATE SET
      total_population = EXCLUDED.total_population,
      elderly_population = EXCLUDED.elderly_population,
      elderly_ratio = EXCLUDED.elderly_ratio,
      raw = EXCLUDED.raw`,
    [row.dongName, row.totalPopulation, row.elderlyPopulation, row.elderlyRatio, JSON.stringify(row)]
  );
}

for (const row of data.existingShades) {
  await query(
    `INSERT INTO shade_facilities
      (management_no, admin_dong_name, name, road_address, lot_address,
       source_type, longitude, latitude, geom, raw)
     VALUES ($1, $2, $3, $4, $5, 'existing', $6, $7,
       ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8::jsonb)
     ON CONFLICT (management_no) WHERE management_no IS NOT NULL AND trim(management_no) <> '' AND status = 'active'
     DO UPDATE SET
       admin_dong_name = EXCLUDED.admin_dong_name,
       name = EXCLUDED.name,
       road_address = EXCLUDED.road_address,
       lot_address = EXCLUDED.lot_address,
       source_type = EXCLUDED.source_type,
       longitude = EXCLUDED.longitude,
       latitude = EXCLUDED.latitude,
       geom = EXCLUDED.geom,
       raw = EXCLUDED.raw,
       updated_at = now()`,
    [
      row.managementNo,
      row.adminDongName,
      row.name,
      row.roadAddress,
      row.lotAddress,
      row.longitude,
      row.latitude,
      JSON.stringify(row.raw)
    ]
  );
}

for (const row of data.sidewalks) {
  await query(
    `INSERT INTO sidewalk_segments
      (route_name, direction_name, location_range, start_address, end_address,
       start_longitude, start_latitude, end_longitude, end_latitude,
       center_longitude, center_latitude, width_m, length_m, area_sqm,
       service_grade, block_type, construction_year, match_status, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)`,
    [
      row.routeName,
      row.directionName,
      row.locationRange,
      row.startAddress,
      row.endAddress,
      row.startLongitude,
      row.startLatitude,
      row.endLongitude,
      row.endLatitude,
      row.centerLongitude,
      row.centerLatitude,
      row.widthM,
      row.lengthM,
      row.areaSqm,
      row.serviceGrade,
      row.blockType,
      row.constructionYear,
      row.startLongitude && row.endLongitude ? "geocoded" : "pending",
      JSON.stringify(row.raw)
    ]
  );
}

console.log("Local source data imported.");
