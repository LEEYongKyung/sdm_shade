import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  port: Number(process.env.PORT || 5174),
  databaseUrl: process.env.DATABASE_URL || "",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin1234",
  sessionSecret: process.env.SESSION_SECRET || "local-dev-session-secret",
  vworldApiKey: process.env.VWORLD_API_KEY || "",
  sourceDataDir: path.resolve(__dirname, "..", process.env.SOURCE_DATA_DIR || "../사용 데이터"),
  projectRoot: path.resolve(__dirname, "..", process.env.PROJECT_ROOT || ".."),
  uploadDir: path.resolve(__dirname, "uploads")
};
