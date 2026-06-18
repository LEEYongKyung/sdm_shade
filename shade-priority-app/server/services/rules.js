export const scoringRules = [
  {
    id: "sidewalk_width_required",
    label: "인도 폭 3.5m 이상",
    description: "국토지리정보원 인도 데이터 기준 필수 설치 조건입니다. 미달 후보지는 자동 제외됩니다.",
    maxScore: 0,
    category: "필수",
    enabled: true,
    locked: true,
    sortOrder: 10
  },
  {
    id: "major_road",
    label: "도로/간선도로성",
    description: "도로명주소 도로구간과 실폭도로 기준. 주도로 25m 이상 5점, 주도로 15m 이상 4점, 12m 이상 3점, 주도로 또는 8m 이상 2점, 기타 1점",
    maxScore: 5,
    category: "입지",
    enabled: true,
    locked: false,
    sortOrder: 20
  },
  {
    id: "intersection",
    label: "교차로/사거리 인접",
    description: "50m 이내 5점, 50~100m 4점, 100~150m 2점",
    maxScore: 5,
    category: "보행",
    enabled: true,
    locked: false,
    sortOrder: 30
  },
  {
    id: "elderly_density",
    label: "고령자 밀집 지역",
    description: "법정동 기준 65세 이상 인구 비율 상위 20% 6점, 20~40% 4점, 40~60% 2점. 법정동 내 여러 행정동이 있으면 가장 높은 행정동 비율을 적용합니다.",
    maxScore: 6,
    category: "수요",
    enabled: true,
    locked: false,
    sortOrder: 40
  },
  {
    id: "cooling_shelter_gap",
    label: "무더위쉼터 접근 부족",
    description: "300m 초과 4점, 150~300m 2점, 150m 이내 0점",
    maxScore: 4,
    category: "수요",
    enabled: true,
    locked: false,
    sortOrder: 50
  },
  {
    id: "existing_shade_exclusion",
    label: "기존 그늘막 80m 이내 제외",
    description: "중복 설치 방지를 위한 필수 제외 조건입니다.",
    maxScore: 0,
    category: "필수",
    enabled: true,
    locked: true,
    sortOrder: 60
  }
];

export function normalizeRuleIds(ids) {
  const enabled = new Set(Array.isArray(ids) ? ids : []);
  for (const rule of scoringRules) {
    if (rule.locked) enabled.add(rule.id);
  }
  return enabled;
}
