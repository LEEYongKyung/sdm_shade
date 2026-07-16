import express from "express";
import multer from "multer";
import fs from "node:fs";
import { config } from "./config.js";
import { dbAvailable, query } from "./db/pool.js";
import { clearCache, loadLocalData, parseInstalledShadeFile } from "./services/dataStore.js";
import { loadCrosswalkContexts } from "./services/crosswalkContext.js";
import { geocodeAddress } from "./services/geocoding.js";
import { distanceMeters } from "./services/geo.js";
import { loadNgiiSidewalkMatches } from "./services/ngiiSidewalkMatch.js";
import { loadRoadAddressMatches } from "./services/roadAddressMatch.js";
import { scoringRules } from "./services/rules.js";
import { scoreCandidates } from "./services/scoring.js";

fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
const upload = multer({ dest: config.uploadDir });
const uploadedShades = [];

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  const data = loadLocalData();
  const uploadedShadeCount = await countUploadedShadeFacilities();
  res.json({
    ok: true,
    dbAvailable: await dbAvailable(),
    counts: {
      crosswalks: data.crosswalks.length,
      shelters: data.shelters.length,
      intersections: data.intersections.length,
      sidewalks: data.sidewalks.length,
      ngiiSidewalkLines: await countNgiiSidewalkLines(),
      roadAddressSegments: await countTable("road_address_segments"),
      roadWidthPolygons: await countTable("road_width_polygons"),
      legalDongBoundaries: await countTable("legal_dong_boundaries"),
      existingShades: data.existingShades.length + uploadedShades.length + uploadedShadeCount
    }
  });
});

app.get("/api/rules", (_req, res) => {
  res.json({ rules: scoringRules });
});

app.get("/api/candidates", async (req, res) => {
  const enabled = parseEnabledRules(req.query.enabled);
  const limit = Number(req.query.limit || 100);
  const mode = String(req.query.mode || "selected");
  const result = scoreCandidates(await prepareScoringData(), enabled);
  const rows = rowsForMode(result, mode);

  res.json({
    summary: result.summary,
    candidates: rows.slice(0, limit),
    mode,
    limit
  });
});

app.get("/api/existing-shades", async (_req, res) => {
  const data = await withUploadedShades(loadLocalData());
  res.json({
    shades: data.existingShades.map(existingShadePayload)
  });
});

app.get("/api/map-layers", async (_req, res) => {
  const data = await withUploadedShades(loadLocalData());
  const crosswalkContexts = await loadCrosswalkContexts();
  const elderlyByLegalDong = buildLegalDongElderlyIndex(data.elderly, crosswalkContexts);
  const elderlyDongs = await loadLegalDongLayer(elderlyByLegalDong);

  res.json({
    existingShades: data.existingShades.map(existingShadePayload),
    coolingShelters: data.shelters.map((shelter, index) => ({
      id: shelter.name || `shelter-${index + 1}`,
      name: shelter.name,
      roadAddress: shelter.roadAddress,
      longitude: shelter.longitude,
      latitude: shelter.latitude
    })),
    elderlyDongs,
    elderlyLegend: elderlyLegend(elderlyDongs.features)
  });
});

app.post("/api/uploads/installed-shades", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "file is required" });
    return;
  }

  const actor = "local-user";
  const year = Number(req.body.year || new Date().getFullYear());
  const { rows, failures } = parseInstalledShadeFile(req.file.path, year);
  const result = {
    batchId: null,
    year,
    totalRows: rows.length + failures.length,
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: failures.length,
    failures,
    changes: []
  };

  if (await dbAvailable()) {
    result.batchId = await createUploadBatch({
      fileName: req.file.originalname,
      year,
      actor,
      totalRows: result.totalRows
    });
    for (const failure of failures) {
      await recordUploadChange({
        batchId: result.batchId,
        row: failure,
        action: "failed",
        errorMessage: failure.reason || "parse failed",
        raw: failure.raw || failure
      });
    }
    for (const row of rows) {
      const action = await upsertInstalledShade(row, actor, result.batchId);
      result[`${action}Count`] += 1;
      if (action !== "skipped") {
        result.changes.push({
          action,
          rowNumber: row.rowNumber,
          managementNo: row.managementNo
        });
      }
    }
    await finalizeUploadBatch(result.batchId, result);
  } else {
    for (const row of rows) {
      const action = upsertMemoryInstalledShade(row);
      result[`${action}Count`] += 1;
    }
  }

  clearCache();
  res.json({
    ...result,
    savedCount: result.insertedCount + result.updatedCount,
    duplicateWarnings: []
  });
});

app.get("/api/uploads/installed-shades/batches", async (req, res) => {
  if (!(await dbAvailable())) {
    res.json({ batches: [] });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 30);
  res.json({ batches: await recentUploadBatches(limit) });
});

app.get("/api/uploads/installed-shades/:batchId/locations", async (req, res) => {
  if (!(await dbAvailable())) {
    res.json({ batchId: Number(req.params.batchId), shades: [] });
    return;
  }
  try {
    const batchId = Number(req.params.batchId);
    const batch = await query(
      `SELECT id, rolled_back_at
       FROM installed_shade_upload_batches
       WHERE id = $1`,
      [batchId]
    );
    if (!batch.rows[0]) {
      res.status(404).json({ error: "upload batch not found" });
      return;
    }
    if (batch.rows[0].rolled_back_at) {
      res.json({ batchId, shades: [], rolledBack: true });
      return;
    }
    res.json({ batchId, shades: await uploadBatchLocations(batchId), rolledBack: false });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/uploads/installed-shades/:batchId/rollback", async (req, res) => {
  if (!(await dbAvailable())) {
    res.status(409).json({ error: "PostgreSQL 연결 상태에서만 롤백할 수 있습니다." });
    return;
  }
  try {
    const result = await rollbackInstalledShadeBatch(Number(req.params.batchId), "local-user");
    clearCache();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/geocode/address", async (req, res) => {
  try {
    const result = await geocodeAddress(req.body.address);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/export/candidates.csv", async (req, res) => {
  const enabled = parseEnabledRules(req.query.enabled);
  const mode = String(req.query.mode || "selected");
  const result = scoreCandidates(await prepareScoringData(), enabled);
  const rows = rowsForMode(result, mode);
  const csv = toCsv(rows);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="shade-candidates-${mode}.csv"`);
  res.send(`\uFEFF${csv}`);
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Shade priority API listening on http://127.0.0.1:${config.port}`);
});

function parseEnabledRules(value) {
  if (!value) return scoringRules.filter((rule) => rule.enabled).map((rule) => rule.id);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function rowsForMode(result, mode) {
  if (mode === "review") return result.review;
  if (mode === "excluded") return result.excluded;
  if (mode === "all") return result.all;
  return result.selected;
}

function existingShadePayload(shade, index = 0) {
  return {
    id: shade.managementNo || shade.name || `existing-${index + 1}`,
    managementNo: shade.managementNo || "",
    dongName: firstText(shade.adminDongName, shade.raw?.["읍면동"], shade.raw?.["행정동"], dongNameFromManagementNo(shade.managementNo)),
    name: firstText(shade.name),
    roadAddress: firstText(shade.roadAddress, shade.raw?.["도로명주소"], shade.raw?.["설치위치"], shade.raw?.["주소"]),
    lotAddress: firstText(shade.lotAddress, shade.raw?.["지번주소"], shade.raw?.["__EMPTY_1"]),
    longitude: shade.longitude,
    latitude: shade.latitude
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function dongNameFromManagementNo(managementNo) {
  return String(managementNo || "").split("-")[0] || "";
}

async function withUploadedShades(data) {
  const dbUploadedShades = await loadUploadedShadeFacilities();
  const localByManagementNo = new Map(
    data.existingShades
      .filter((shade) => shade.managementNo)
      .map((shade) => [shade.managementNo, shade])
  );
  const mergedUploadedShades = [...uploadedShades, ...dbUploadedShades].map((shade) =>
    mergeUploadedShadeWithLocalFallback(shade, localByManagementNo.get(shade.managementNo))
  );
  const uploadedManagementNos = new Set(
    mergedUploadedShades
      .map((shade) => shade.managementNo)
      .filter(Boolean)
  );
  const localExistingShades = data.existingShades.filter(
    (shade) => !uploadedManagementNos.has(shade.managementNo)
  );
  return {
    ...data,
    existingShades: [...localExistingShades, ...mergedUploadedShades]
  };
}

function mergeUploadedShadeWithLocalFallback(uploaded, local) {
  if (!local) return uploaded;
  return {
    ...uploaded,
    adminDongName: uploaded.adminDongName || local.adminDongName || "",
    name: uploaded.name || local.name || "",
    roadAddress: uploaded.roadAddress || local.roadAddress || "",
    lotAddress: uploaded.lotAddress || local.lotAddress || "",
    raw: {
      ...(local.raw || {}),
      ...(uploaded.raw || {})
    }
  };
}

async function prepareScoringData() {
  const data = await withUploadedShades(loadLocalData());
  return {
    ...data,
    crosswalkContexts: await loadCrosswalkContexts(),
    sidewalkMatches: await loadNgiiSidewalkMatches(data.crosswalks),
    roadMatches: await loadRoadAddressMatches(data.crosswalks)
  };
}

async function countNgiiSidewalkLines() {
  if (!(await dbAvailable())) return 0;
  try {
    const result = await query("SELECT count(*)::int AS count FROM ngii_sidewalk_lines");
    return result.rows[0]?.count || 0;
  } catch {
    return 0;
  }
}

async function countTable(tableName) {
  if (!(await dbAvailable())) return 0;
  try {
    const result = await query(`SELECT count(*)::int AS count FROM ${tableName}`);
    return result.rows[0]?.count || 0;
  } catch {
    return 0;
  }
}

async function countUploadedShadeFacilities() {
  if (!(await dbAvailable())) return 0;
  try {
    const result = await query(
      `SELECT count(*)::int AS count
       FROM shade_facilities
       WHERE source_type = 'installed_upload'
         AND status = 'active'`
    );
    return result.rows[0]?.count || 0;
  } catch {
    return 0;
  }
}

async function loadUploadedShadeFacilities() {
  if (!(await dbAvailable())) return [];
  try {
    const result = await query(
      `SELECT management_no, admin_dong_name, name, road_address, lot_address,
              installed_year, longitude, latitude, raw
       FROM shade_facilities
       WHERE source_type = 'installed_upload'
         AND status = 'active'
         AND longitude IS NOT NULL
         AND latitude IS NOT NULL`
    );
    return result.rows.map((row) => ({
      managementNo: row.management_no,
      adminDongName: row.admin_dong_name,
      name: row.name,
      roadAddress: row.road_address,
      lotAddress: row.lot_address,
      installedYear: row.installed_year,
      longitude: Number(row.longitude),
      latitude: Number(row.latitude),
      raw: row.raw || {}
    }));
  } catch {
    return [];
  }
}

async function upsertInstalledShade(row, actor, batchId = null) {
  const existing = await findInstalledShadeByManagementNo(row.managementNo);
  if (!existing) {
    await insertInstalledShade(row);
    await recordUploadChange({
      batchId,
      row,
      action: "inserted",
      beforeData: null,
      afterData: compactShade(row)
    });
    await audit(actor, "installed_shade_insert", "shade_facilities", row.managementNo, { rowNumber: row.rowNumber });
    return "inserted";
  }

  if (!installedShadeChanged(existing, row)) {
    await recordUploadChange({
      batchId,
      row,
      action: "skipped",
      beforeData: compactShade(existing),
      afterData: compactShade(row)
    });
    return "skipped";
  }

  const before = compactShade(existing);
  await updateInstalledShade(existing.id, row);
  await recordUploadChange({
    batchId,
    row,
    action: "updated",
    beforeData: before,
    afterData: compactShade(row)
  });
  await audit(actor, "installed_shade_update", "shade_facilities", row.managementNo, {
    rowNumber: row.rowNumber,
    before,
    after: compactShade(row)
  });
  return "updated";
}

async function findInstalledShadeByManagementNo(managementNo) {
  const result = await query(
    `SELECT *
     FROM shade_facilities
     WHERE management_no = $1
       AND status = 'active'
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [managementNo]
  );
  return result.rows[0] || null;
}

async function insertInstalledShade(row) {
  await query(
    `INSERT INTO shade_facilities
      (management_no, admin_dong_name, name, road_address, lot_address,
       installed_year, source_type, longitude, latitude, geom, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'installed_upload', $7, $8,
       ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9::jsonb, now())`,
    [
      row.managementNo,
      row.adminDongName,
      row.name,
      row.roadAddress,
      row.lotAddress,
      row.installedYear,
      row.longitude,
      row.latitude,
      JSON.stringify(row.raw)
    ]
  );
}

async function updateInstalledShade(id, row) {
  await query(
    `UPDATE shade_facilities
     SET admin_dong_name = $2,
         name = $3,
         road_address = $4,
         lot_address = $5,
         installed_year = $6,
         source_type = 'installed_upload',
         longitude = $7,
         latitude = $8,
         geom = ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
         raw = $9::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      id,
      row.adminDongName,
      row.name,
      row.roadAddress,
      row.lotAddress,
      row.installedYear,
      row.longitude,
      row.latitude,
      JSON.stringify(row.raw)
    ]
  );
}

async function createUploadBatch({ fileName, year, actor, totalRows }) {
  const result = await query(
    `INSERT INTO installed_shade_upload_batches
      (file_name, installed_year, uploaded_by, total_rows, status)
     VALUES ($1, $2, $3, $4, 'processing')
     RETURNING id`,
    [fileName, year, actor, totalRows]
  );
  return result.rows[0].id;
}

async function finalizeUploadBatch(batchId, result) {
  await query(
    `UPDATE installed_shade_upload_batches
     SET inserted_count = $2,
         updated_count = $3,
         skipped_count = $4,
         failed_count = $5,
         status = 'completed'
     WHERE id = $1`,
    [
      batchId,
      result.insertedCount,
      result.updatedCount,
      result.skippedCount,
      result.failedCount
    ]
  );
}

async function recordUploadChange({
  batchId,
  row,
  action,
  beforeData = null,
  afterData = null,
  errorMessage = null,
  raw = null
}) {
  if (!batchId) return;
  await query(
    `INSERT INTO installed_shade_upload_changes
      (batch_id, row_number, management_no, action, before_data, after_data, error_message, raw)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb)`,
    [
      batchId,
      row?.rowNumber ?? null,
      row?.managementNo ?? row?.management_no ?? null,
      action,
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null,
      errorMessage,
      JSON.stringify(raw || row?.raw || row || {})
    ]
  );
}

async function recentUploadBatches(limit) {
  const result = await query(
    `SELECT id, file_name, installed_year, uploaded_by, total_rows,
            inserted_count, updated_count, skipped_count, failed_count,
            status, created_at, rolled_back_at, rolled_back_by
     FROM installed_shade_upload_batches
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    installedYear: row.installed_year,
    uploadedBy: row.uploaded_by,
    totalRows: row.total_rows,
    insertedCount: row.inserted_count,
    updatedCount: row.updated_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    status: row.status,
    createdAt: row.created_at,
    rolledBackAt: row.rolled_back_at,
    rolledBackBy: row.rolled_back_by
  }));
}

async function uploadBatchLocations(batchId) {
  const result = await query(
    `SELECT DISTINCT ON (management_no)
            management_no,
            action,
            after_data
     FROM installed_shade_upload_changes
     WHERE batch_id = $1
       AND action IN ('inserted', 'updated')
       AND after_data IS NOT NULL
     ORDER BY management_no, id DESC`,
    [batchId]
  );

  return result.rows
    .map((row) => {
      const data = row.after_data || {};
      const longitude = Number(data.longitude);
      const latitude = Number(data.latitude);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      return {
        managementNo: data.managementNo || row.management_no,
        adminDongName: data.adminDongName,
        name: data.name,
        roadAddress: data.roadAddress,
        lotAddress: data.lotAddress,
        installedYear: data.installedYear,
        longitude,
        latitude,
        action: row.action
      };
    })
    .filter(Boolean);
}

async function rollbackInstalledShadeBatch(batchId, actor) {
  const batch = await query("SELECT * FROM installed_shade_upload_batches WHERE id = $1", [batchId]);
  const batchRow = batch.rows[0];
  if (!batchRow) throw new Error("업로드 배치를 찾을 수 없습니다.");
  if (batchRow.rolled_back_at) throw new Error("이미 롤백된 업로드 배치입니다.");

  const changes = await query(
    `SELECT *
     FROM installed_shade_upload_changes
     WHERE batch_id = $1
     ORDER BY id DESC`,
    [batchId]
  );
  const result = {
    batchId,
    rolledBackInserted: 0,
    rolledBackUpdated: 0,
    skippedChanges: 0,
    failedChanges: 0
  };

  for (const change of changes.rows) {
    if (change.action === "inserted") {
      await rollbackInsertedShade(change.after_data);
      result.rolledBackInserted += 1;
    } else if (change.action === "updated") {
      await restoreShadeFromSnapshot(change.before_data);
      result.rolledBackUpdated += 1;
    } else if (change.action === "failed") {
      result.failedChanges += 1;
    } else {
      result.skippedChanges += 1;
    }
  }

  await query(
    `UPDATE installed_shade_upload_batches
     SET status = 'rolled_back',
         rolled_back_at = now(),
         rolled_back_by = $2
     WHERE id = $1`,
    [batchId, actor]
  );
  await audit(actor, "installed_shade_upload_rollback", "installed_shade_upload_batches", String(batchId), result);
  return result;
}

async function rollbackInsertedShade(snapshot) {
  const managementNo = snapshot?.managementNo || snapshot?.management_no;
  if (!managementNo) return;
  await query(
    `UPDATE shade_facilities
     SET status = 'rolled_back',
         updated_at = now()
     WHERE management_no = $1
       AND source_type = 'installed_upload'
       AND status = 'active'`,
    [managementNo]
  );
}

async function restoreShadeFromSnapshot(snapshot) {
  if (!snapshot?.managementNo) return;
  const existing = await findInstalledShadeByManagementNo(snapshot.managementNo);
  if (existing) {
    await updateInstalledShade(existing.id, snapshot);
  } else {
    await insertInstalledShade(snapshot);
  }
}

function upsertMemoryInstalledShade(row) {
  const index = uploadedShades.findIndex((shade) => shade.managementNo === row.managementNo);
  if (index === -1) {
    uploadedShades.push(row);
    return "inserted";
  }
  if (!installedShadeChanged(uploadedShades[index], row)) return "skipped";
  uploadedShades[index] = row;
  return "updated";
}

function installedShadeChanged(existing, row) {
  return (
    textValue(existing.name) !== textValue(row.name) ||
    textValue(existing.admin_dong_name ?? existing.adminDongName) !== textValue(row.adminDongName) ||
    textValue(existing.road_address ?? existing.roadAddress) !== textValue(row.roadAddress) ||
    textValue(existing.lot_address ?? existing.lotAddress) !== textValue(row.lotAddress) ||
    Number(existing.installed_year ?? existing.installedYear) !== Number(row.installedYear) ||
    coordinateChanged(existing, row)
  );
}

function coordinateChanged(existing, row) {
  const longitude = Number(existing.longitude);
  const latitude = Number(existing.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return true;
  return distanceMeters({ longitude, latitude }, row) > 1;
}

function compactShade(row) {
  return {
    managementNo: row.management_no ?? row.managementNo,
    adminDongName: row.admin_dong_name ?? row.adminDongName,
    name: row.name,
    roadAddress: row.road_address ?? row.roadAddress,
    lotAddress: row.lot_address ?? row.lotAddress,
    installedYear: row.installed_year ?? row.installedYear,
    longitude: row.longitude,
    latitude: row.latitude,
    raw: row.raw || {}
  };
}

function textValue(value) {
  return String(value ?? "").trim();
}

async function audit(actor, action, entityType, entityId, detail) {
  await query(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actor, action, entityType, entityId, JSON.stringify(detail)]
  );
}

async function loadLegalDongLayer(elderlyByLegalDong) {
  if (!(await dbAvailable())) {
    return { type: "FeatureCollection", features: [] };
  }

  const result = await query(
    `SELECT
      emd_cd,
      emd_name,
      ST_AsGeoJSON(ST_Transform(geom, 4326), 6)::json AS geometry
     FROM legal_dong_boundaries
     WHERE sig_cd = '11410'
     ORDER BY emd_name`
  );

  const ratios = [...elderlyByLegalDong.values()]
    .map((row) => row.elderlyRatio)
    .filter((value) => Number.isFinite(value));
  const minRatio = Math.min(...ratios, 0);
  const maxRatio = Math.max(...ratios, 0);

  return {
    type: "FeatureCollection",
    features: result.rows.map((row) => {
      const elderly = elderlyByLegalDong.get(normalizeLegalDongName(row.emd_name));
      const ratio = elderly?.elderlyRatio ?? null;
      const colorIndex = colorIndexForRatio(ratio, minRatio, maxRatio);
      return {
        type: "Feature",
        geometry: row.geometry,
        properties: {
          emdCode: row.emd_cd,
          dongName: row.emd_name,
          elderlyRatio: ratio,
          elderlyPopulation: elderly?.elderlyPopulation ?? null,
          totalPopulation: elderly?.totalPopulation ?? null,
          sourceDongName: elderly?.dongName ?? "",
          color: elderlyColor(colorIndex),
          colorIndex
        }
      };
    })
  };
}

function buildLegalDongElderlyIndex(elderlyRows, crosswalkContexts = new Map()) {
  const adminNamesByLegalDong = new Map();
  for (const context of crosswalkContexts.values()) {
    const legalDongName = normalizeLegalDongName(context.legalDongName);
    const adminDongName = normalizeAdminDongName(context.adminDongName);
    if (!legalDongName || !adminDongName) continue;
    if (!adminNamesByLegalDong.has(legalDongName)) adminNamesByLegalDong.set(legalDongName, new Set());
    adminNamesByLegalDong.get(legalDongName).add(adminDongName);
  }
  for (const [legalDongName, adminDongNames] of legalDongAdminAliases()) {
    if (!adminNamesByLegalDong.has(legalDongName)) adminNamesByLegalDong.set(legalDongName, new Set());
    for (const adminDongName of adminDongNames) {
      adminNamesByLegalDong.get(legalDongName).add(adminDongName);
    }
  }

  const legalDongNames = new Set([
    ...elderlyRows.map((row) => normalizeLegalDongName(row.dongName)).filter(Boolean),
    ...adminNamesByLegalDong.keys()
  ]);

  const result = new Map();
  for (const legalDongName of legalDongNames) {
    const adminNames = adminNamesByLegalDong.get(legalDongName) || new Set();
    const matches = elderlyRows.filter((row) => {
      const rowAdminName = normalizeAdminDongName(row.dongName);
      return normalizeLegalDongName(row.dongName) === legalDongName || adminNames.has(rowAdminName);
    });
    if (!matches.length) continue;
    const best = matches.reduce((currentBest, row) => (row.elderlyRatio > currentBest.elderlyRatio ? row : currentBest), matches[0]);
    result.set(legalDongName, { ...best, legalDongName });
  }
  return result;
}

function elderlyLegend(features) {
  const ratios = features
    .map((feature) => feature.properties.elderlyRatio)
    .filter((value) => Number.isFinite(value));
  const min = Math.min(...ratios, 0);
  const max = Math.max(...ratios, 0);
  return Array.from({ length: 5 }, (_, index) => {
    const from = min + ((max - min) * index) / 5;
    const to = min + ((max - min) * (index + 1)) / 5;
    return {
      color: elderlyColor(index),
      label: `${percent(from)}~${percent(to)}`
    };
  });
}

function colorIndexForRatio(ratio, min, max) {
  if (!Number.isFinite(ratio) || max <= min) return 0;
  return Math.min(4, Math.max(0, Math.floor(((ratio - min) / (max - min)) * 5)));
}

function elderlyColor(index) {
  return ["#fee2e2", "#fca5a5", "#f87171", "#dc2626", "#7f1d1d"][index] || "#fee2e2";
}

function percent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function normalizeLegalDongName(value) {
  return normalizeAdminDongName(value).replace(/\d+동$/, "동").trim();
}

function normalizeAdminDongName(value) {
  const text = String(value || "").replace(/\s+/g, "").trim();
  if (text.startsWith("홍제")) return text.replace("홍제제", "홍제");
  return text.replace(/제(?=\d+동$)/, "").trim();
}

function legalDongAdminAliases() {
  return new Map([
    ["남가좌동", ["남가좌1동", "남가좌2동"]],
    ["북가좌동", ["북가좌1동", "북가좌2동"]],
    ["홍은동", ["홍은1동", "홍은2동"]],
    ["홍제동", ["홍제1동", "홍제2동", "홍제3동"]],
    ["봉원동", ["신촌동"]],
    ["대신동", ["신촌동"]],
    ["대현동", ["신촌동"]],
    ["창천동", ["신촌동"]],
    ["신촌동", ["신촌동"]],
    ["충정로2가", ["충현동"]],
    ["충정로3가", ["충현동"]],
    ["합동", ["충현동"]],
    ["미근동", ["충현동"]],
    ["냉천동", ["천연동"]],
    ["영천동", ["천연동"]],
    ["옥천동", ["천연동"]],
    ["현저동", ["천연동"]],
    ["천연동", ["천연동"]],
    ["북아현동", ["북아현동"]],
    ["연희동", ["연희동"]]
  ]);
}

function toCsv(rows) {
  const header = [
    "순위",
    "행정동",
    "노드ID",
    "상태",
    "총점",
    "도로명",
    "도로폭",
    "인도폭",
    "도로간선도로성점수",
    "교차로점수",
    "고령자점수",
    "쉼터점수",
    "기존그늘막거리m",
    "기존그늘막거리점수",
    "무더위쉼터거리m",
    "교차로거리m",
    "제외사유",
    "현장확인사항",
    "경도",
    "위도"
  ];
  const lines = rows.map((row, index) =>
    [
      row.rank || index + 1,
      row.dongName,
      row.nodeId,
      statusLabel(row.status),
      row.totalScore,
      row.roadName || "",
      row.roadEffectiveWidthM ?? row.roadWidthM ?? "",
      row.sidewalkWidthM ?? "",
      row.breakdown?.major_road?.score ?? 0,
      row.breakdown?.intersection?.score ?? 0,
      row.breakdown?.elderly_density?.score ?? 0,
      row.breakdown?.cooling_shelter_gap?.score ?? 0,
      round(row.nearestExistingShadeM),
      row.breakdown?.existing_shade_distance?.score ?? 0,
      round(row.nearestCoolingShelterM),
      round(row.nearestIntersectionM),
      row.exclusionReason,
      row.reviewFlags.join("; "),
      row.longitude,
      row.latitude
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : "";
}

function statusLabel(status) {
  if (status === "selected") return "선정";
  if (status === "review_required") return "현장 확인 필요";
  return "제외";
}
