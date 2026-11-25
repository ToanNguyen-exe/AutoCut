import fs from "node:fs";
import path from "node:path";

function parseDotEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1).trim();
      }
      if (val) {
        parsed[key] = val;
      }
    }
    return parsed;
  } catch (err) {
    console.warn("Không thể đọc fallback .env ở thư mục gốc:", err);
    return {};
  }
}

/**
 * Tìm thư mục gốc dự án (ưu tiên thư mục cha chứa tệp `.env` chung khi chạy trong `frontend/`).
 */
export function resolveProjectRootDir(cwd: string = process.cwd()): string {
  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, ".env"))) {
    return parent;
  }
  if (fs.existsSync(path.join(cwd, ".env"))) {
    return cwd;
  }
  return fs.existsSync(path.join(cwd, "transcripts")) ? cwd : parent;
}

/**
 * Tìm giá trị biến môi trường theo danh sách tên ưu tiên:
 * 1. Đọc từ `env` (process.env khi chạy server/deploy).
 * 2. Dự phòng đọc trực tiếp từ tệp `.env` chung ở thư mục gốc dự án (AutoCut/.env).
 */
export function resolveEnvKey(
  keys: readonly string[],
  env: Record<string, string | undefined> = process.env,
  projectRoot: string = resolveProjectRootDir()
): string {
  for (const key of keys) {
    const val = (env[key] || "").trim();
    if (val) {
      return val;
    }
  }

  const parsed = parseDotEnvFile(path.join(projectRoot, ".env"));
  for (const key of keys) {
    const val = (parsed[key] || "").trim();
    if (val) {
      return val;
    }
  }
  return "";
}

/**
 * Tìm GROQ_API_KEY / WHISPER_API_KEY từ biến môi trường Next.js,
 * và tự đọc dự phòng từ tệp `.env` ở thư mục gốc dự án khi chạy local.
 */
export function resolveGroqApiKey(
  env: Record<string, string | undefined>,
  projectRoot: string
): string {
  return resolveEnvKey(["GROQ_API_KEY", "WHISPER_API_KEY"], env, projectRoot);
}
