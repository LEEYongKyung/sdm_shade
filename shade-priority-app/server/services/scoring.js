import { distanceMeters, nearestDistanceMeters } from "./geo.js";
import { normalizeRuleIds } from "./rules.js";

export function scoreCandidates(data, requestedRuleIds) {
  const enabled = normalizeRuleIds(requestedRuleIds);
  const elderlyByLegalDong = buildLegalDongElderlyIndex(data.elderly, data.crosswalkContexts);
  const evaluated = data.crosswalks.map((crosswalk) =>
    evaluateCandidate(crosswalk, { ...data, elderlyByLegalDong }, enabled)
  );
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
      sidewalkSegmentCount: data.sidewalkMatches?.size ?? data.sidewalks.length,
      existingShadeCount: data.existingShades.length,
      maxScore: maxScore(enabled)
    }
  };
}

function evaluateCandidate(crosswalk, data, enabled) {
  const point = { longitude: crosswalk.longitude, latitude: crosswalk.latitude };
  const nearestExistingShadeM = nearestDistanceMeters(point, data.existingShades);
  const nearestCoolingShelterM = nearestDistanceMeters(point, data.shelters);
  const nearestIntersectionM = nearestDistanceMeters(point, data.intersections);
  const sidewalkMatch = data.sidewalkMatches?.get(crosswalk.nodeId) ?? findLegacySidewalkMatch(point, data.sidewalks);
  const roadMatch = data.roadMatches?.get(crosswalk.nodeId) ?? null;
  const context = data.crosswalkContexts?.get(crosswalk.nodeId) ?? null;
  const legalDongName = context?.legalDongName || normalizeLegalDongName(crosswalk.dongName);
  const elderly = findLegalDongElderlyPopulation(legalDongName, data.elderlyByLegalDong);

  const reviewFlags = [];
  const breakdown = {};
  let status = "selected";
  let exclusionReason = "";

  if (Number.isFinite(nearestExistingShadeM) && nearestExistingShadeM < 8) {
    status = "excluded";
    exclusionReason = "기존 그늘막 8m 미만";
  }

  if (!sidewalkMatch) {
    status = status === "excluded" ? status : "review_required";
    reviewFlags.push("인도 폭 데이터 없음");
  } else if (!Number.isFinite(sidewalkMatch.widthM) || sidewalkMatch.widthM <= 0) {
    status = status === "excluded" ? status : "review_required";
    reviewFlags.push("인도 폭 미상");
  } else if (sidewalkMatch.widthM < 3.5) {
    status = "excluded";
    exclusionReason = `인도 폭 ${sidewalkMatch.widthM}m로 3.5m 미만`;
  }

  addScore("major_road", enabled, breakdown, roadHierarchyScore(roadMatch, context, data.roads));
  addScore("intersection", enabled, breakdown, intersectionScore(nearestIntersectionM));
  addScore("elderly_density", enabled, breakdown, elderlyScore(elderly));
  addScore("cooling_shelter_gap", enabled, breakdown, shelterGapScore(nearestCoolingShelterM));
  addScore("existing_shade_distance", enabled, breakdown, existingShadeDistanceScore(nearestExistingShadeM));

  if (status === "selected" && shouldReviewSidewalkConfidence(sidewalkMatch?.confidence)) {
    reviewFlags.push(`인도 폭 매칭 신뢰도 ${sidewalkMatch?.confidence || "NONE"}`);
  }
  if (status === "selected" && enabled.has("major_road") && !roadMatch && !context?.roadName) {
    reviewFlags.push("도로구간 매칭 없음");
  }
  if (Number.isFinite(nearestExistingShadeM) && nearestExistingShadeM >= 8 && nearestExistingShadeM < 30) {
    reviewFlags.push("기존 그늘막 30m 미만");
  }

  return {
    id: crosswalk.nodeId,
    nodeId: crosswalk.nodeId,
    dongName: legalDongName || crosswalk.dongName,
    sourceDongName: crosswalk.dongName,
    roadName: roadMatch?.roadName || context?.roadName || "",
    roadAddress: context?.roadAddress || "",
    parcelAddress: context?.parcelAddress || "",
    roadClassCode: roadMatch?.roadClassCode || "",
    roadWidthM: roadMatch?.roadWidthM ?? null,
    roadEffectiveWidthM: roadMatch?.effectiveWidthM ?? null,
    roadPolygonWidthM: roadMatch?.polygonWidthM ?? null,
    roadDistanceM: roadMatch?.distanceM ?? null,
    roadMatchConfidence: roadMatch?.confidence || "NONE",
    legalDongName,
    adminDongName: context?.adminDongName || "",
    longitude: crosswalk.longitude,
    latitude: crosswalk.latitude,
    totalScore: Object.values(breakdown).reduce((sum, item) => sum + item.score, 0),
    status,
    exclusionReason,
    reviewFlags,
    sidewalkWidthM: sidewalkMatch?.widthM ?? null,
    sidewalkNearbyMaxWidthM: sidewalkMatch?.nearbyMaxWidthM ?? null,
    sidewalkDistanceM: sidewalkMatch?.distanceM ?? null,
    sidewalkRouteName: sidewalkMatch?.routeName ?? "",
    sidewalkLocationRange: sidewalkMatch?.locationRange ?? "",
    sidewalkMatchConfidence: sidewalkMatch?.confidence ?? "NONE",
    nearestExistingShadeM: finiteOrNull(nearestExistingShadeM),
    nearestCoolingShelterM: finiteOrNull(nearestCoolingShelterM),
    nearestIntersectionM: finiteOrNull(nearestIntersectionM),
    breakdown
  };
}

function addScore(ruleId, enabled, breakdown, item) {
  if (!enabled.has(ruleId)) return;
  breakdown[ruleId] = typeof item === "object" && item !== null
    ? { score: Number(item.score) || 0, ...item }
    : { score: Number(item) || 0 };
}

function shouldReviewSidewalkConfidence(confidence) {
  return confidence === "LOW" || confidence === "NONE" || !confidence;
}

function roadHierarchyScore(roadMatch, context, roads) {
  if (roadMatch) return roadAddressScore(roadMatch);

  const route = findRoadRoute(context?.roadName, roads);
  if (!route) {
    return { score: 0, reason: context?.roadName ? "도로노선 미매칭" : "도로구간 매칭 없음" };
  }

  const roadScale = String(route.roadScale || "");
  const roadFunction = String(route.roadFunction || "");
  const width = roadWidthMeters(route.roadWidthLabel);

  if (roadScale.includes("광로") || roadFunction.includes("주간선")) {
    return { score: 5, roadName: route.routeName, roadScale, roadFunction, roadWidthLabel: route.roadWidthLabel };
  }
  if (roadScale.includes("대로") || roadFunction.includes("보조간선")) {
    return { score: 4, roadName: route.routeName, roadScale, roadFunction, roadWidthLabel: route.roadWidthLabel };
  }
  if (roadScale.includes("중로") || (Number.isFinite(width) && width >= 12)) {
    return { score: 2, roadName: route.routeName, roadScale, roadFunction, roadWidthLabel: route.roadWidthLabel };
  }
  return { score: 1, roadName: route.routeName, roadScale, roadFunction, roadWidthLabel: route.roadWidthLabel };
}

function roadAddressScore(roadMatch) {
  const width = roadMatch.effectiveWidthM ?? roadMatch.roadWidthM;
  const isMainRoad = roadMatch.roadClassCode === "3";
  const base = {
    roadName: roadMatch.roadName,
    roadClassCode: roadMatch.roadClassCode,
    roadWidthM: roadMatch.roadWidthM,
    effectiveWidthM: roadMatch.effectiveWidthM,
    polygonWidthM: roadMatch.polygonWidthM,
    distanceM: roadMatch.distanceM,
    confidence: roadMatch.confidence
  };

  if (!Number.isFinite(width) || width <= 0) {
    return { ...base, score: isMainRoad ? 2 : 0, reason: "도로폭 미상" };
  }
  if (isMainRoad && width >= 25) return { ...base, score: 5 };
  if (isMainRoad && width >= 15) return { ...base, score: 4 };
  if (width >= 12) return { ...base, score: 3 };
  if (isMainRoad || width >= 8) return { ...base, score: 2 };
  return { ...base, score: 1 };
}

function findRoadRoute(roadName, roads) {
  const normalized = normalizeRoadName(roadName);
  if (!normalized) return null;
  return roads.find((route) => normalizeRoadName(route.routeName) === normalized) || null;
}

function normalizeRoadName(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function roadWidthMeters(label) {
  const text = String(label || "");
  if (text.includes("6m미만")) return 6;
  const range = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)m?/);
  if (range) return Number(range[2]);
  const single = text.match(/(\d+(?:\.\d+)?)m/);
  return single ? Number(single[1]) : null;
}

function intersectionScore(distance) {
  if (!Number.isFinite(distance)) return 0;
  if (distance <= 50) return 5;
  if (distance <= 100) return 4;
  if (distance <= 150) return 2;
  return 0;
}

function elderlyScore(elderly) {
  if (!elderly) return 0;
  if (elderly.ratioRankPercent <= 0.2) return 6;
  if (elderly.ratioRankPercent <= 0.4) return 4;
  if (elderly.ratioRankPercent <= 0.6) return 2;
  return 0;
}

function buildLegalDongElderlyIndex(elderlyRows, crosswalkContexts = new Map()) {
  const adminNamesByLegalDong = new Map();
  for (const context of crosswalkContexts.values()) {
    const legalDongName = normalizeLegalDongName(context.legalDongName);
    const adminDongName = normalizeAdminDongName(context.adminDongName);
    if (!legalDongName || !adminDongName) continue;
    if (!adminNamesByLegalDong.has(legalDongName)) {
      adminNamesByLegalDong.set(legalDongName, new Set());
    }
    adminNamesByLegalDong.get(legalDongName).add(adminDongName);
  }
  for (const [legalDongName, adminDongNames] of legalDongAdminAliases()) {
    if (!adminNamesByLegalDong.has(legalDongName)) {
      adminNamesByLegalDong.set(legalDongName, new Set());
    }
    for (const adminDongName of adminDongNames) {
      adminNamesByLegalDong.get(legalDongName).add(adminDongName);
    }
  }

  const legalDongNames = new Set([
    ...elderlyRows.map((row) => normalizeLegalDongName(row.dongName)).filter(Boolean),
    ...adminNamesByLegalDong.keys()
  ]);

  const bestByLegalDong = new Map();
  for (const legalDongName of legalDongNames) {
    const adminNames = adminNamesByLegalDong.get(legalDongName) || new Set();
    const matches = elderlyRows.filter((row) => {
      const rowAdminName = normalizeAdminDongName(row.dongName);
      return normalizeLegalDongName(row.dongName) === legalDongName || adminNames.has(rowAdminName);
    });
    if (!matches.length) continue;
    const best = matches.reduce((currentBest, row) => (row.elderlyRatio > currentBest.elderlyRatio ? row : currentBest), matches[0]);
    bestByLegalDong.set(legalDongName, { ...best, legalDongName });
  }

  const ranked = [...bestByLegalDong.values()].sort((a, b) => b.elderlyRatio - a.elderlyRatio);
  return new Map(
    ranked.map((row, index) => [
      row.legalDongName,
      {
        ...row,
        ratioRankPercent: index / Math.max(ranked.length - 1, 1)
      }
    ])
  );
}

function findLegalDongElderlyPopulation(legalDongName, elderlyByLegalDong) {
  return elderlyByLegalDong.get(normalizeLegalDongName(legalDongName)) || null;
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

function shelterGapScore(distance) {
  if (!Number.isFinite(distance)) return 4;
  if (distance <= 150) return 0;
  if (distance <= 300) return 2;
  return 4;
}

function existingShadeDistanceScore(distance) {
  if (!Number.isFinite(distance)) return { score: 3, reason: "기존 그늘막 없음" };
  if (distance >= 80) return { score: 3 };
  if (distance >= 50) return { score: 2 };
  if (distance >= 30) return { score: 1 };
  return { score: 0, reason: "기존 그늘막 30m 미만" };
}

function findLegacySidewalkMatch(point, sidewalks) {
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
    (b.nearestExistingShadeM || 0) - (a.nearestExistingShadeM || 0)
  );
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function maxScore(enabled) {
  let total = 0;
  if (enabled.has("major_road")) total += 5;
  if (enabled.has("intersection")) total += 5;
  if (enabled.has("elderly_density")) total += 6;
  if (enabled.has("cooling_shelter_gap")) total += 4;
  if (enabled.has("existing_shade_distance")) total += 3;
  return total;
}
