import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { dbAvailable, query } from "./db/pool.js";
import { parseInstalledShadeFile, loadLocalData, clearCache } from "./services/dataStore.js";
import { scoreCandidates } from "./services/scoring.js";
import { scoringRules } from "./services/rules.js";
import { geocodeAddress } from "./services/geocoding.js";
import { nearestDistanceMeters } from "./services/geo.js";

fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
const upload = multer({ dest: config.uploadDir });
const uploadedShades = [];

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  const data = loadLocalData();
  res.json({
    ok: true,
    dbAvailable: await dbAvailable(),
    counts: {
      crosswalks: data.crosswalks.length,
      shelters: data.shelters.length,
      intersections: data.intersections.length,
      sidewalks: data.sidewalks.length,
      existingShades: data.existingShades.length + uploadedShades.length
    }
  });
});

app.get("/api/rules", (_req, res) => {
  res.json({ rules: scoringRules });
});

app.get("/api/candidates", (req, res) => {
  const enabled = parseEnabledRules(req.query.enabled);
  const limit = Number(req.query.limit || 100);
  const mode = String(req.query.mode || "selected");
  const data = withUploadedShades(loadLocalData());
  const result = scoreCandidates(data, enabled);
  const rows = rowsForMode(result, mode);

  res.json({
    summary: result.summary,
    candidates: rows.slice(0, limit),
    mode,
    limit
  });
});

app.get("/api/existing-shades", (_req, res) => {
  const data = withUploadedShades(loadLocalData());
  res.json({
    shades: data.existingShades.map((shade) => ({
      id: shade.managementNo || shade.name,
      managementNo: shade.managementNo,
      name: shade.name,
      longitude: shade.longitude,
      latitude: shade.latitude
    }))
  });
});

app.post("/api/uploads/installed-shades", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "file is required" });
    return;
  }

  const year = Number(req.body.year || new Date().getFullYear());
  const rows = parseInstalledShadeFile(req.file.path, year);
  const data = withUploadedShades(loadLocalData());
  const duplicateWarnings = rows.map((row) => ({
    ...row,
    nearestExistingShadeM: nearestDistanceMeters(row, data.existingShades)
  }));

  if (await dbAvailable()) {
    for (const row of rows) {
      await query(
        `INSERT INTO shade_facilities
          (management_no, name, installed_year, source_type, longitude, latitude, geom, raw)
         VALUES ($1, $2, $3, 'installed_upload', $4, $5,
          ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6::jsonb)`,
        [
          row.managementNo,
          row.name,
          row.installedYear,
          row.longitude,
          row.latitude,
          JSON.stringify(row.raw)
        ]
      );
    }
  } else {
    uploadedShades.push(...rows);
  }

  clearCache();
  res.json({
    savedCount: rows.length,
    year,
    duplicateWarnings: duplicateWarnings
      .filter((row) => Number.isFinite(row.nearestExistingShadeM) && row.nearestExistingShadeM <= 20)
      .slice(0, 50)
  });
});

app.post("/api/geocode/address", async (req, res) => {
  try {
    const result = await geocodeAddress(req.body.address);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/export/candidates.csv", (req, res) => {
  const enabled = parseEnabledRules(req.query.enabled);
  const mode = String(req.query.mode || "selected");
  const data = withUploadedShades(loadLocalData());
  const result = scoreCandidates(data, enabled);
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

function withUploadedShades(data) {
  return {
    ...data,
    existingShades: [...data.existingShades, ...uploadedShades]
  };
}

function toCsv(rows) {
  const header = [
    "순위",
    "행정동",
    "노드ID",
    "상태",
    "총점",
    "보도폭",
    "보도폭매칭신뢰도",
    "보도구간",
    "기존그늘막거리m",
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
      row.sidewalkWidthM ?? "",
      row.sidewalkMatchConfidence,
      row.sidewalkLocationRange,
      round(row.nearestExistingShadeM),
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
