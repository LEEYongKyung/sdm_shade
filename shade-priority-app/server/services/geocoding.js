import { config } from "../config.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function geocodeAddress(address) {
  if (!config.vworldApiKey) {
    throw new Error("VWORLD_API_KEY is not configured.");
  }

  const url = buildVworldUrl(address);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`VWorld geocoding failed: ${response.status}`);
    }
    return parseVworldPayload(address, await response.json());
  } catch (error) {
    if (error?.cause?.code !== "SELF_SIGNED_CERT_IN_CHAIN") {
      throw error;
    }
    return geocodeAddressWithPowerShell(address, url.toString());
  }
}

export async function reverseGeocodePoint({ longitude, latitude }) {
  if (!config.vworldApiKey) {
    throw new Error("VWORLD_API_KEY is not configured.");
  }

  const url = buildVworldReverseUrl({ longitude, latitude });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`VWorld reverse geocoding failed: ${response.status}`);
    }
    return parseVworldReversePayload({ longitude, latitude }, await response.json());
  } catch (error) {
    if (error?.cause?.code !== "SELF_SIGNED_CERT_IN_CHAIN") {
      throw error;
    }
    return reverseGeocodePointWithPowerShell({ longitude, latitude }, url.toString());
  }
}

function buildVworldUrl(address) {
  const url = new URL("https://api.vworld.kr/req/address");
  url.searchParams.set("service", "address");
  url.searchParams.set("request", "getcoord");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "epsg:4326");
  url.searchParams.set("address", address);
  url.searchParams.set("refine", "true");
  url.searchParams.set("simple", "false");
  url.searchParams.set("format", "json");
  url.searchParams.set("type", "road");
  url.searchParams.set("key", config.vworldApiKey);
  return url;
}

function buildVworldReverseUrl({ longitude, latitude }) {
  const url = new URL("https://api.vworld.kr/req/address");
  url.searchParams.set("service", "address");
  url.searchParams.set("request", "getAddress");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "epsg:4326");
  url.searchParams.set("point", `${longitude},${latitude}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("type", "both");
  url.searchParams.set("key", config.vworldApiKey);
  return url;
}

function parseVworldPayload(address, payload) {
  const point = payload?.response?.result?.point;
  if (!point) {
    return { address, status: "not_found", longitude: null, latitude: null };
  }

  return {
    address,
    status: "ok",
    longitude: Number(point.x),
    latitude: Number(point.y)
  };
}

function parseVworldReversePayload(point, payload) {
  const status = payload?.response?.status;
  const rows = Array.isArray(payload?.response?.result) ? payload.response.result : [];
  if (status !== "OK" || !rows.length) {
    return {
      ...point,
      status: "not_found",
      confidence: "NONE",
      raw: payload
    };
  }

  const road = rows.find((row) => row.type === "road");
  const parcel = rows.find((row) => row.type === "parcel");
  const roadStruct = road?.structure || {};
  const parcelStruct = parcel?.structure || {};

  return {
    ...point,
    status: "ok",
    confidence: road && parcel ? "HIGH" : "MEDIUM",
    roadAddress: road?.text || "",
    parcelAddress: parcel?.text || "",
    roadName: roadStruct.level4L || "",
    roadCode: roadStruct.level4LC || "",
    legalDongName: parcelStruct.level4L || roadStruct.level3 || "",
    legalDongCode: parcelStruct.level4LC || "",
    adminDongName: parcelStruct.level4A || roadStruct.level4A || "",
    adminDongCode: parcelStruct.level4AC || roadStruct.level4AC || "",
    raw: payload
  };
}

async function geocodeAddressWithPowerShell(address, url) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; Invoke-WebRequest -Uri $env:VWORLD_URL -UseBasicParsing | Select-Object -ExpandProperty Content"
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        VWORLD_URL: url
      }
    }
  );
  return parseVworldPayload(address, JSON.parse(stdout));
}

async function reverseGeocodePointWithPowerShell(point, url) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; Invoke-WebRequest -Uri $env:VWORLD_URL -UseBasicParsing | Select-Object -ExpandProperty Content"
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        VWORLD_URL: url
      }
    }
  );
  return parseVworldReversePayload(point, JSON.parse(stdout));
}
