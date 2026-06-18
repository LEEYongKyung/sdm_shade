import { dbAvailable, query } from "../db/pool.js";

const SEARCH_RADIUS_M = 30;

export async function loadNgiiSidewalkMatches(crosswalks) {
  if (!(await dbAvailable()) || !crosswalks.length) return new Map();

  const values = [];
  const params = [];
  crosswalks.forEach((crosswalk, index) => {
    const offset = index * 3;
    values.push(`($${offset + 1}::text, $${offset + 2}::double precision, $${offset + 3}::double precision)`);
    params.push(crosswalk.nodeId, crosswalk.longitude, crosswalk.latitude);
  });

  const result = await query(
    `WITH candidates(node_id, longitude, latitude) AS (
       VALUES ${values.join(",")}
     ),
     candidate_points AS (
       SELECT
        node_id,
        ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 5179) AS geom
       FROM candidates
     ),
     matches AS (
       SELECT
        c.node_id,
        s.ufid,
        s.width_m,
        s.material_code,
        s.bicycle_yn_code,
        s.kind_code,
        s.integrated_code,
        ST_Distance(c.geom, s.geom) AS distance_m,
        row_number() OVER (
          PARTITION BY c.node_id
          ORDER BY
            CASE WHEN s.width_m >= 3.5 THEN 0 ELSE 1 END,
            ST_Distance(c.geom, s.geom),
            s.width_m DESC NULLS LAST
        ) AS rn,
        max(s.width_m) FILTER (WHERE s.width_m > 0) OVER (PARTITION BY c.node_id) AS nearby_max_width_m,
        count(*) OVER (PARTITION BY c.node_id) AS nearby_count
       FROM candidate_points c
       JOIN ngii_sidewalk_lines s
        ON s.kind_code = 'SWK001'
       AND ST_DWithin(c.geom, s.geom, $${params.length + 1})
     )
     SELECT *
     FROM matches
     WHERE rn = 1`,
    [...params, SEARCH_RADIUS_M]
  );

  return new Map(
    result.rows.map((row) => [
      String(row.node_id),
      {
        ufid: row.ufid,
        widthM: numberFrom(row.width_m),
        nearbyMaxWidthM: numberFrom(row.nearby_max_width_m),
        nearbyCount: Number(row.nearby_count || 0),
        distanceM: numberFrom(row.distance_m),
        materialCode: row.material_code,
        bicycleYnCode: row.bicycle_yn_code,
        kindCode: row.kind_code,
        integratedCode: row.integrated_code,
        routeName: "NGII sidewalk",
        locationRange: row.ufid,
        confidence: confidenceFrom(numberFrom(row.distance_m))
      }
    ])
  );
}

function confidenceFrom(distanceM) {
  if (!Number.isFinite(distanceM)) return "NONE";
  if (distanceM <= 10) return "HIGH";
  if (distanceM <= 30) return "MEDIUM";
  return "LOW";
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
