export function meters(value) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value)}m`;
}

export function number(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return Number(value).toFixed(digits);
}

export function statusLabel(status) {
  if (status === "selected") return "선정";
  if (status === "review_required") return "현장 확인";
  return "제외";
}

export function statusClass(status) {
  if (status === "selected") return "is-selected";
  if (status === "review_required") return "is-review";
  return "is-excluded";
}
