import "../config.js";
import { clearCache, loadLocalData } from "../services/dataStore.js";
import { syncCrosswalkContexts } from "../services/crosswalkContext.js";

const refresh = process.argv.includes("--refresh");
const delayArg = process.argv.find((arg) => arg.startsWith("--delay="));
const delayMs = delayArg ? Number(delayArg.split("=")[1]) : 80;

clearCache();
const data = loadLocalData();
const result = await syncCrosswalkContexts(data.crosswalks, { refresh, delayMs });

console.log(JSON.stringify(result, null, 2));
process.exit(result.failed ? 1 : 0);
