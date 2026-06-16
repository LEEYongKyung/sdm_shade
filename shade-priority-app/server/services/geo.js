import proj4 from "proj4";

proj4.defs(
  "EPSG:5186",
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs"
);

export function parseWktPoint(wkt) {
  if (!wkt) return null;
  const match = String(wkt).match(/POINT\s*\(\s*([0-9.-]+)\s+([0-9.-]+)\s*\)/i);
  if (!match) return null;
  return { longitude: Number(match[1]), latitude: Number(match[2]) };
}

export function epsg5186ToWgs84(x, y) {
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  const [longitude, latitude] = proj4("EPSG:5186", "EPSG:4326", [nx, ny]);
  return { longitude, latitude };
}

export function distanceMeters(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function nearestDistanceMeters(point, points) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const candidate of points) {
    const distance = distanceMeters(point, candidate);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

export function routeNameFromAddress(address) {
  if (!address) return "";
  const match = String(address).match(/([가-힣0-9.]+(?:로|길))/);
  return match?.[1] || "";
}

function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}
