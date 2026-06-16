import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearCache, loadLocalData } from "../services/dataStore.js";
import { geocodeAddress } from "../services/geocoding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cachePath = path.resolve(__dirname, "..", "data", "sidewalk-geocodes.json");
const existing = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
  : [];
const byAddress = new Map(existing.map((row) => [row.address, row]));

clearCache();
const data = loadLocalData();
const addresses = [
  ...new Set(
    data.sidewalks
      .flatMap((row) => [row.startAddress, row.endAddress])
      .filter(Boolean)
  )
].filter((address) => !byAddress.has(address) || byAddress.get(address)?.status !== "ok");

console.log(`Geocoding ${addresses.length} sidewalk addresses. Existing cache: ${existing.length}`);

for (let index = 0; index < addresses.length; index += 1) {
  const address = addresses[index];
  try {
    const result = await geocodeAddress(address);
    byAddress.set(address, result);
    console.log(`${index + 1}/${addresses.length}`, result.status, address);
  } catch (error) {
    byAddress.set(address, {
      address,
      status: "error",
      error: error.message,
      longitude: null,
      latitude: null
    });
    console.log(`${index + 1}/${addresses.length} error ${address}: ${error.message}`);
  }

  fs.writeFileSync(cachePath, JSON.stringify([...byAddress.values()], null, 2), "utf8");
  await new Promise((resolve) => setTimeout(resolve, 120));
}

console.log(`Saved ${byAddress.size} geocode results to ${cachePath}`);
