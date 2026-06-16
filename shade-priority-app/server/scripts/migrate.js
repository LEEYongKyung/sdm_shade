import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../db/pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, "..", "db", "schema.sql");

await query(fs.readFileSync(schemaPath, "utf8"));
console.log("Database schema migrated.");
