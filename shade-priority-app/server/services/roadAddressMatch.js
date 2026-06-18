import { dbAvailable, query } from "../db/pool.js";

const ROAD_SEARCH_RADIUS_M = 45;
const WIDTH_POLYGON_SEARCH_RADIUS_M = 35;

export async function loadRoadAddressMatches(crosswalks) {
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
     road_matches AS (
       SELECT
        c.node_id,
        r.id,
        r.sig_cd,
        r.rds_man_no,
        r.road_name,
        r.road_name_code,
        r.road_class_code,
        r.road_width_m,
        r.road_length_m,
        r.start_location,
        r.end_location,
        r.geom,
        ST_Distance(c.geom, r.geom) AS distance_m,
        row_number() OVER (
          PARTITION BY c.node_id
          ORDER BY
            ST_Distance(c.geom, r.geom),
            CASE WHEN r.road_class_code = '3' THEN 0 ELSE 1 END,
            r.road_width_m DESC NULLS LAST
        ) AS rn
       FROM candidate_points c
       JOIN road_address_segments r
         ON r.sig_cd = '11410'
        AND ST_DWithin(c.geom, r.geom, $${params.length + 1})
     ),
     selected_roads AS (
       SELECT *
       FROM road_matches
       WHERE rn = 1
     ),
     corrected AS (
       SELECT
        r.*,
        p.rw_sn AS width_polygon_sn,
        p.distance_m AS width_polygon_distance_m,
        p.estimated_width_m AS polygon_width_m
       FROM selected_roads r
       LEFT JOIN LATERAL (
        SELECT
          p.rw_sn,
          ST_Distance(r.geom, p.geom) AS distance_m,
          ST_Area(p.geom) / NULLIF(ST_Length(ST_Intersection(p.geom, r.geom)), 0) AS estimated_width_m
        FROM road_width_polygons p
        WHERE p.sig_cd = r.sig_cd
          AND ST_DWithin(r.geom, p.geom, $${params.length + 2})
          AND ST_DWithin(
            (SELECT geom FROM candidate_points c WHERE c.node_id = r.node_id),
            p.geom,
            $${params.length + 3}
          )
        ORDER BY
          ST_Distance((SELECT geom FROM candidate_points c WHERE c.node_id = r.node_id), p.geom),
          ST_Area(p.geom) DESC
        LIMIT 1
       ) p ON true
     )
     SELECT
      *,
      GREATEST(
        COALESCE(NULLIF(road_width_m, 0), 0),
        CASE
          WHEN polygon_width_m BETWEEN 2 AND 80 THEN polygon_width_m
          ELSE 0
        END
      ) AS effective_width_m
     FROM corrected`,
    [
      ...params,
      ROAD_SEARCH_RADIUS_M,
      WIDTH_POLYGON_SEARCH_RADIUS_M,
      WIDTH_POLYGON_SEARCH_RADIUS_M
    ]
  );

  return new Map(
    result.rows.map((row) => [
      String(row.node_id),
      {
        segmentId: Number(row.id),
        sigCd: row.sig_cd,
        rdsManNo: Number(row.rds_man_no),
        roadName: row.road_name || "",
        roadNameCode: row.road_name_code || "",
        roadClassCode: row.road_class_code || "",
        roadWidthM: numberFrom(row.road_width_m),
        roadLengthM: numberFrom(row.road_length_m),
        effectiveWidthM: numberFrom(row.effective_width_m),
        polygonWidthM: numberFrom(row.polygon_width_m),
        widthPolygonSn: row.width_polygon_sn ? Number(row.width_polygon_sn) : null,
        widthPolygonDistanceM: numberFrom(row.width_polygon_distance_m),
        distanceM: numberFrom(row.distance_m),
        startLocation: row.start_location || "",
        endLocation: row.end_location || "",
        confidence: confidenceFrom(numberFrom(row.distance_m), numberFrom(row.effective_width_m))
      }
    ])
  );
}

function confidenceFrom(distanceM, widthM) {
  if (!Number.isFinite(distanceM)) return "NONE";
  if (distanceM <= 15 && Number.isFinite(widthM) && widthM > 0) return "HIGH";
  if (distanceM <= ROAD_SEARCH_RADIUS_M) return "MEDIUM";
  return "LOW";
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
