import { distanceMeters, nearestDistanceMeters } from "./geo.js";
import { normalizeRuleIds } from "./rules.js";

export function scoreCandidates(data, requestedRuleIds) {
  const enabled = normalizeRuleIds(requestedRuleIds);
  const evaluated = data.crosswalks.map((crosswalk) => evaluateCandidate(crosswalk, data, enabled));
  const selected = evaluated
    .filter((candidate) => candidate.status === "selected")
    .sort(sortCandidates)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const review = evaluated
    .filter((candidate) => candidate.status === "review_required")
    .sort(sortCandidates);
  const excluded = evaluated
    .filter((candidate) => candidate.status === "excluded")
    .sort(sortCandidates);

  return {
    selected,
    review,
    excluded,
    all: [...selected, ...review, ...excluded],
    summary: {
      sourceCandidateCount: data.crosswalks.length,
      selectedCount: selected.length,
      reviewRequiredCount: review.length,
      excludedCount: excluded.length,
      sidewalkSegmentCount: data.sidewalks.length,
      existingShadeCount: data.existingShades.length
    }
  };
}

function evaluateCandidate(crosswalk, data, enabled) {
  const point = { longitude: crosswalk.longitude, latitude: crosswalk.latitude };
  const nearestExistingShadeM = nearestDistanceMeters(point, data.existingShades);
  const nearestCoolingShelterM = nearestDistanceMeters(point, data.shelters);
  const nearestIntersectionM = nearestDistanceMeters(point, data.intersections);
  const sidewalkMatch = findSidewalkMatch(point, data.sidewalks);
  const elderly = data.elderly.find((item) => item.dongName === crosswalk.dongName);
  const legacy = data.legacyTop100.get(crosswalk.nodeId);

  const reviewFlags = [];
  const breakdown = {};
  let totalScore = 0;
  let status = "selected";
  let exclusionReason = "";

  if (Number.isFinite(nearestExistingShadeM) && nearestExistingShadeM <= 80) {
    status = "excluded";
    exclusionReason = "기존 그늘막 80m 이내";
  }

  if (!sidewalkMatch) {
    status = status === "excluded" ? status : "review_required";
    reviewFlags.push("보도폭 데이터 없음");
  } else if (sidewalkMatch.widthM < 3.5) {
    status = "excluded";
    exclusionReason = `보도폭 ${sidewalkMatch.widthM}m로 3.5m 미만`;
  }

  addScore("sidewalk_width_bonus", enabled, breakdown, (sidewalkMatch?.widthM || 0) >= 4 ? 2 : (sidewalkMatch?.widthM || 0) >= 3.5 ? 1 : 0);
  addScore("major_road", enabled, breakdown, legacy?.roadScore ?? 0);
  addScore("intersection", enabled, breakdown, distanceScore(nearestIntersectionM, 50, 100, 3, 2));
  addScore("crosswalk_match", enabled, breakdown, 2);
  addScore("elderly_density", enabled, breakdown, elderlyScore(elderly, legacy));
  addScore("cooling_shelter_gap", enabled, breakdown, shelterGapScore(nearestCoolingShelterM));

  totalScore = Object.values(breakdown).reduce((sum, item) => sum + item.score, 0);

  if (status === "selected" && sidewalkMatch?.confidence !== "HIGH") {
    reviewFlags.push(`보도폭 매칭 신뢰도 ${sidewalkMatch?.confidence || "NONE"}`);
  }

  return {
    id: crosswalk.nodeId,
    nodeId: crosswalk.nodeId,
    dongName: crosswalk.dongName,
    longitude: crosswalk.longitude,
    latitude: crosswalk.latitude,
    totalScore,
    status,
    exclusionReason,
    reviewFlags,
    sidewalkWidthM: sidewalkMatch?.widthM ?? null,
    sidewalkRouteName: sidewalkMatch?.routeName ?? "",
    sidewalkLocationRange: sidewalkMatch?.locationRange ?? "",
    sidewalkMatchConfidence: sidewalkMatch?.confidence ?? "NONE",
    nearestExistingShadeM: finiteOrNull(nearestExistingShadeM),
    nearestCoolingShelterM: finiteOrNull(nearestCoolingShelterM),
    nearestIntersectionM: finiteOrNull(nearestIntersectionM),
    breakdown
  };
}

function addScore(ruleId, enabled, breakdown, score) {
  if (!enabled.has(ruleId)) return;
  breakdown[ruleId] = { score: Number(score) || 0 };
}

function distanceScore(distance, near, mid, nearScore, midScore) {
  if (!Number.isFinite(distance)) return 0;
  if (distance <= near) return nearScore;
  if (distance <= mid) return midScore;
  return 0;
}

function shelterGapScore(distance) {
  if (!Number.isFinite(distance)) return 2;
  if (distance <= 300) return 0;
  if (distance <= 500) return 1;
  return 2;
}

function elderlyScore(elderly, legacy) {
  if (elderly) {
    if (elderly.ratioRankPercent <= 0.3) return 2;
    if (elderly.ratioRankPercent <= 0.5) return 1;
    return 0;
  }
  return legacy?.elderlyScore ?? 0;
}

function findSidewalkMatch(point, sidewalks) {
  let best = null;
  for (const segment of sidewalks) {
    const start = coordinate(segment.startLongitude, segment.startLatitude);
    const end = coordinate(segment.endLongitude, segment.endLatitude);
    const center = coordinate(segment.centerLongitude, segment.centerLatitude);
    const distances = [start, end, center].filter(Boolean).map((coord) => distanceMeters(point, coord));
    if (distances.length === 0) continue;
    const distance = Math.min(...distances);
    if (!best || distance < best.distanceM) {
      best = { ...segment, distanceM: distance };
    }
  }

  if (!best) return null;
  if (best.distanceM <= 30) return { ...best, confidence: "HIGH" };
  if (best.distanceM <= 80) return { ...best, confidence: "MEDIUM" };
  return null;
}

function coordinate(longitude, latitude) {
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? { longitude, latitude }
    : null;
}

function sortCandidates(a, b) {
  return (
    b.totalScore - a.totalScore ||
    (b.sidewalkWidthM || 0) - (a.sidewalkWidthM || 0) ||
    (a.nearestExistingShadeM || 99999) - (b.nearestExistingShadeM || 99999)
  );
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}
