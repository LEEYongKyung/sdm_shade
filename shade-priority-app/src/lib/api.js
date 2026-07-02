export async function getHealth() {
  return request("/api/health");
}

export async function getRules() {
  return request("/api/rules");
}

export async function getCandidates({ enabledRuleIds, mode }) {
  const limitsByMode = {
    selected: "1000",
    review: "200",
    excluded: "500",
    all: "500"
  };
  const params = new URLSearchParams({
    enabled: enabledRuleIds.join(","),
    mode,
    limit: limitsByMode[mode] || "100"
  });
  return request(`/api/candidates?${params.toString()}`);
}

export async function getExistingShades() {
  return request("/api/existing-shades");
}

export async function getMapLayers() {
  return request("/api/map-layers");
}

export async function getInstalledShadeUploadBatches() {
  return request("/api/uploads/installed-shades/batches");
}

export async function getInstalledShadeUploadBatchLocations(batchId) {
  return request(`/api/uploads/installed-shades/${batchId}/locations`);
}

export async function rollbackInstalledShadeUploadBatch(batchId) {
  return request(`/api/uploads/installed-shades/${batchId}/rollback`, { method: "POST" });
}

export async function uploadInstalledShades({ file, year }) {
  const form = new FormData();
  form.append("file", file);
  form.append("year", year);
  const response = await fetch("/api/uploads/installed-shades", {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
