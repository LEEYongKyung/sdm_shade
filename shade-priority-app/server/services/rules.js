export const scoringRules = [
  {
    id: "sidewalk_width_required",
    label: "인도 폭 3.5m 이상",
    description: "그늘막 설치 기준의 필수 조건입니다. 미달 후보지는 자동 제외됩니다.",
    maxScore: 0,
    category: "필수",
    enabled: true,
    locked: true,
    sortOrder: 10
  },
  {
    id: "sidewalk_width_bonus",
    label: "충분한 보도폭",
    description: "3.5m 이상 1점, 4.0m 이상 2점",
    maxScore: 2,
    category: "입지",
    enabled: true,
    locked: false,
    sortOrder: 20
  },
  {
    id: "major_road",
    label: "주요 간선도로/대로변",
    description: "주요 간선도로와 대로변 횡단보도 인접성",
    maxScore: 3,
    category: "입지",
    enabled: true,
    locked: false,
    sortOrder: 30
  },
  {
    id: "intersection",
    label: "교차로/사거리 인접",
    description: "50m 이내 3점, 50~100m 2점",
    maxScore: 3,
    category: "보행",
    enabled: true,
    locked: false,
    sortOrder: 40
  },
  {
    id: "crosswalk_match",
    label: "대로변 횡단보도 DB 일치",
    description: "서울시 대로변 횡단보도 위치정보 기반 기본 후보지",
    maxScore: 2,
    category: "보행",
    enabled: true,
    locked: false,
    sortOrder: 50
  },
  {
    id: "elderly_density",
    label: "고령자 밀집 지역",
    description: "행정동별 65세 이상 인구 비중 상위권",
    maxScore: 2,
    category: "수요",
    enabled: true,
    locked: false,
    sortOrder: 60
  },
  {
    id: "cooling_shelter_gap",
    label: "무더위쉼터 접근 부족",
    description: "300m 이내 쉼터 없음 2점, 300~500m 1점",
    maxScore: 2,
    category: "수요",
    enabled: true,
    locked: false,
    sortOrder: 70
  },
  {
    id: "existing_shade_exclusion",
    label: "기존 그늘막 80m 이내 제외",
    description: "중복 설치 방지를 위한 필수 제외 조건입니다.",
    maxScore: 0,
    category: "필수",
    enabled: true,
    locked: true,
    sortOrder: 80
  }
];

export function normalizeRuleIds(ids) {
  const enabled = new Set(Array.isArray(ids) ? ids : []);
  for (const rule of scoringRules) {
    if (rule.locked) enabled.add(rule.id);
  }
  return enabled;
}
