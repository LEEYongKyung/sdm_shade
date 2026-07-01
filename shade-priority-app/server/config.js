import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");

export const config = {
  port: Number(process.env.PORT || 5174),
  databaseUrl: process.env.DATABASE_URL || "",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin1234",
  sessionSecret: process.env.SESSION_SECRET || "local-dev-session-secret",
  vworldApiKey: process.env.VWORLD_API_KEY || "",
  sourceDataDir: path.resolve(appRoot, process.env.SOURCE_DATA_DIR || "../\uc0ac\uc6a9 \ub370\uc774\ud130"),
  projectRoot: path.resolve(appRoot, process.env.PROJECT_ROOT || ".."),
  ngiiSidewalkDir: process.env.NGII_SIDEWALK_DIR
    ? path.resolve(appRoot, process.env.NGII_SIDEWALK_DIR)
    : path.resolve(appRoot, "..", "\uc778\ub3c4 \ub370\uc774\ud130", "N3L_A0033320"),
  roadAddressSegmentDir: process.env.ROAD_ADDRESS_SEGMENT_DIR
    ? path.resolve(appRoot, process.env.ROAD_ADDRESS_SEGMENT_DIR)
    : path.resolve(appRoot, "..", "(\ub3c4\ub85c\uba85\uc8fc\uc18c)\ub3c4\ub85c\uad6c\uac04_\uc11c\uc6b8"),
  roadWidthPolygonDir: process.env.ROAD_WIDTH_POLYGON_DIR
    ? path.resolve(appRoot, process.env.ROAD_WIDTH_POLYGON_DIR)
    : path.resolve(appRoot, "..", "(\ub3c4\ub85c\uba85\uc8fc\uc18c)\uc2e4\ud3ed\ub3c4\ub85c_\uc11c\uc6b8"),
  legalDongBoundaryDir: process.env.LEGAL_DONG_BOUNDARY_DIR
    ? path.resolve(appRoot, process.env.LEGAL_DONG_BOUNDARY_DIR)
    : path.resolve(appRoot, "..", "\ubc95\uc815\ub3d9 \uacbd\uacc4 \ub370\uc774\ud130"),
  uploadDir: path.resolve(__dirname, "uploads")
};
