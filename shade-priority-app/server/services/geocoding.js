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
