CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS crosswalks (
  id BIGSERIAL PRIMARY KEY,
  node_id TEXT UNIQUE NOT NULL,
  node_type TEXT,
  district_code TEXT,
  district_name TEXT,
  dong_code TEXT,
  dong_name TEXT,
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  geom GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) STORED,
  source_year INTEGER,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_key TEXT,
  source_origin TEXT NOT NULL DEFAULT 'local',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cooling_shelters (
  id BIGSERIAL PRIMARY KEY,
  facility_year INTEGER,
  name TEXT,
  road_address TEXT,
  lot_address TEXT,
  capacity INTEGER,
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION,
  geom GEOGRAPHY(Point, 4326),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_key TEXT,
  source_origin TEXT NOT NULL DEFAULT 'local',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intersections (
  id BIGSERIAL PRIMARY KEY,
  intersection_code TEXT UNIQUE,
  name TEXT,
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION,
  geom GEOGRAPHY(Point, 4326),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_key TEXT,
  source_origin TEXT NOT NULL DEFAULT 'local',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS road_routes (
  id BIGSERIAL PRIMARY KEY,
  route_name TEXT NOT NULL,
  road_type TEXT,
  road_function TEXT,
  road_scale TEXT,
  road_width_label TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_key TEXT,
  source_origin TEXT NOT NULL DEFAULT 'local',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS elderly_population (
  id BIGSERIAL PRIMARY KEY,
  year_quarter TEXT NOT NULL,
  dong_name TEXT NOT NULL,
  total_population INTEGER,
  elderly_population INTEGER,
  elderly_ratio DOUBLE PRECISION,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year_quarter, dong_name)
);

CREATE TABLE IF NOT EXISTS shade_facilities (
  id BIGSERIAL PRIMARY KEY,
  management_no TEXT,
  admin_dong_name TEXT,
  name TEXT,
  road_address TEXT,
  lot_address TEXT,
  installed_year INTEGER,
  source_type TEXT NOT NULL DEFAULT 'existing',
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION,
  geom GEOGRAPHY(Point, 4326),
  status TEXT NOT NULL DEFAULT 'active',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sidewalk_segments (
  id BIGSERIAL PRIMARY KEY,
  route_name TEXT NOT NULL,
  direction_name TEXT,
  location_range TEXT,
  start_address TEXT,
  end_address TEXT,
  start_longitude DOUBLE PRECISION,
  start_latitude DOUBLE PRECISION,
  end_longitude DOUBLE PRECISION,
  end_latitude DOUBLE PRECISION,
  center_longitude DOUBLE PRECISION,
  center_latitude DOUBLE PRECISION,
  width_m DOUBLE PRECISION,
  length_m DOUBLE PRECISION,
  area_sqm DOUBLE PRECISION,
  service_grade TEXT,
  block_type TEXT,
  construction_year TEXT,
  match_status TEXT NOT NULL DEFAULT 'pending',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ngii_sidewalk_lines (
  id BIGSERIAL PRIMARY KEY,
  ufid TEXT UNIQUE NOT NULL,
  width_m DOUBLE PRECISION,
  material_code TEXT,
  bicycle_yn_code TEXT,
  kind_code TEXT,
  integrated_code TEXT,
  production_info TEXT,
  geom GEOMETRY(LineString, 5179) NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scoring_rules (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  max_score DOUBLE PRECISION NOT NULL,
  category TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS simulation_runs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  year INTEGER NOT NULL,
  enabled_rule_ids TEXT[] NOT NULL,
  rule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidate_count INTEGER NOT NULL,
  selected_count INTEGER NOT NULL,
  review_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_scores (
  id BIGSERIAL PRIMARY KEY,
  simulation_run_id BIGINT REFERENCES simulation_runs(id) ON DELETE CASCADE,
  crosswalk_node_id TEXT NOT NULL,
  rank_no INTEGER,
  total_score DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  exclusion_reason TEXT,
  review_flags TEXT[] NOT NULL DEFAULT '{}',
  sidewalk_width_m DOUBLE PRECISION,
  sidewalk_match_confidence TEXT,
  nearest_existing_shade_m DOUBLE PRECISION,
  nearest_cooling_shelter_m DOUBLE PRECISION,
  nearest_intersection_m DOUBLE PRECISION,
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crosswalks_geom_idx ON crosswalks USING GIST (geom);
CREATE INDEX IF NOT EXISTS cooling_shelters_geom_idx ON cooling_shelters USING GIST (geom);
CREATE INDEX IF NOT EXISTS intersections_geom_idx ON intersections USING GIST (geom);
CREATE INDEX IF NOT EXISTS shade_facilities_geom_idx ON shade_facilities USING GIST (geom);
CREATE INDEX IF NOT EXISTS ngii_sidewalk_lines_geom_idx ON ngii_sidewalk_lines USING GIST (geom);
CREATE INDEX IF NOT EXISTS ngii_sidewalk_lines_kind_width_idx ON ngii_sidewalk_lines (kind_code, width_m);

CREATE TABLE IF NOT EXISTS crosswalk_contexts (
  id BIGSERIAL PRIMARY KEY,
  node_id TEXT UNIQUE NOT NULL REFERENCES crosswalks(node_id) ON DELETE CASCADE,
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  road_address TEXT,
  parcel_address TEXT,
  road_name TEXT,
  road_code TEXT,
  legal_dong_name TEXT,
  legal_dong_code TEXT,
  admin_dong_name TEXT,
  admin_dong_code TEXT,
  match_status TEXT NOT NULL DEFAULT 'pending',
  confidence TEXT NOT NULL DEFAULT 'NONE',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crosswalk_contexts_road_name_idx ON crosswalk_contexts (road_name);
CREATE INDEX IF NOT EXISTS crosswalk_contexts_legal_dong_name_idx ON crosswalk_contexts (legal_dong_name);

CREATE TABLE IF NOT EXISTS road_address_segments (
  id BIGSERIAL PRIMARY KEY,
  sig_cd TEXT NOT NULL,
  rds_man_no BIGINT NOT NULL,
  road_name TEXT,
  road_name_code TEXT,
  english_road_name TEXT,
  road_class_code TEXT,
  dependent_section_code TEXT,
  road_width_m DOUBLE PRECISION,
  road_length_m DOUBLE PRECISION,
  start_location TEXT,
  end_location TEXT,
  announced_date TEXT,
  operation_date TEXT,
  geom GEOMETRY(Geometry, 5179) NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sig_cd, rds_man_no)
);

CREATE TABLE IF NOT EXISTS road_width_polygons (
  id BIGSERIAL PRIMARY KEY,
  sig_cd TEXT NOT NULL,
  rw_sn BIGINT NOT NULL,
  operation_date TEXT,
  geom GEOMETRY(Geometry, 5179) NOT NULL,
  area_sqm DOUBLE PRECISION GENERATED ALWAYS AS (ST_Area(geom)) STORED,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sig_cd, rw_sn)
);

CREATE INDEX IF NOT EXISTS road_address_segments_geom_idx ON road_address_segments USING GIST (geom);
CREATE INDEX IF NOT EXISTS road_address_segments_name_idx ON road_address_segments (road_name);
CREATE INDEX IF NOT EXISTS road_address_segments_sig_idx ON road_address_segments (sig_cd);
CREATE INDEX IF NOT EXISTS road_width_polygons_geom_idx ON road_width_polygons USING GIST (geom);
CREATE INDEX IF NOT EXISTS road_width_polygons_sig_idx ON road_width_polygons (sig_cd);

CREATE TABLE IF NOT EXISTS legal_dong_boundaries (
  id BIGSERIAL PRIMARY KEY,
  emd_cd TEXT UNIQUE NOT NULL,
  sig_cd TEXT NOT NULL,
  emd_name TEXT NOT NULL,
  sgg_oid DOUBLE PRECISION,
  geom GEOMETRY(Geometry, 5186) NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_dong_boundaries_geom_idx ON legal_dong_boundaries USING GIST (geom);
CREATE INDEX IF NOT EXISTS legal_dong_boundaries_sig_name_idx ON legal_dong_boundaries (sig_cd, emd_name);

CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS data_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  dataset TEXT NOT NULL,
  service_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  upserted_count INTEGER NOT NULL DEFAULT 0,
  deactivated_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  triggered_by TEXT,
  message TEXT,
  raw_summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS data_sync_errors (
  id BIGSERIAL PRIMARY KEY,
  sync_run_id BIGINT REFERENCES data_sync_runs(id) ON DELETE CASCADE,
  dataset TEXT NOT NULL,
  source_key TEXT,
  error_message TEXT NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS installed_shade_upload_batches (
  id BIGSERIAL PRIMARY KEY,
  file_name TEXT,
  installed_year INTEGER,
  uploaded_by TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by TEXT
);

CREATE TABLE IF NOT EXISTS installed_shade_upload_changes (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES installed_shade_upload_batches(id) ON DELETE CASCADE,
  row_number INTEGER,
  management_no TEXT,
  action TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  error_message TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE crosswalks ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE crosswalks ADD COLUMN IF NOT EXISTS source_origin TEXT NOT NULL DEFAULT 'local';
ALTER TABLE crosswalks ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE crosswalks ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE crosswalks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE cooling_shelters ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE cooling_shelters ADD COLUMN IF NOT EXISTS source_origin TEXT NOT NULL DEFAULT 'local';
ALTER TABLE cooling_shelters ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE cooling_shelters ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE cooling_shelters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE intersections ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE intersections ADD COLUMN IF NOT EXISTS source_origin TEXT NOT NULL DEFAULT 'local';
ALTER TABLE intersections ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE intersections ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE intersections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE road_routes ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE road_routes ADD COLUMN IF NOT EXISTS source_origin TEXT NOT NULL DEFAULT 'local';
ALTER TABLE road_routes ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE road_routes ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE road_routes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE shade_facilities ADD COLUMN IF NOT EXISTS admin_dong_name TEXT;
ALTER TABLE shade_facilities ADD COLUMN IF NOT EXISTS road_address TEXT;
ALTER TABLE shade_facilities ADD COLUMN IF NOT EXISTS lot_address TEXT;
ALTER TABLE shade_facilities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS memo TEXT;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS rule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS excluded_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS cooling_shelters_source_key_idx ON cooling_shelters (source_key) WHERE source_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS road_routes_source_key_idx ON road_routes (source_key) WHERE source_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shade_facilities_management_no_uidx ON shade_facilities (management_no) WHERE management_no IS NOT NULL AND trim(management_no) <> '' AND status = 'active';
CREATE INDEX IF NOT EXISTS data_sync_runs_started_at_idx ON data_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS installed_shade_upload_batches_created_at_idx ON installed_shade_upload_batches (created_at DESC);
CREATE INDEX IF NOT EXISTS installed_shade_upload_changes_batch_id_idx ON installed_shade_upload_changes (batch_id, id DESC);
