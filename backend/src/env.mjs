import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 專案根目錄若有 .env 就載入（Node 內建，不需要套件）。
 * 這個模組必須在任何會讀取 process.env 的模組「之前」被 import。
 *
 * loadEnvFile 會覆蓋既有的環境變數，但部署平台（例如 Railway）設定的值應該優先，
 * 所以先備份、載入後再還原原本就存在的鍵。
 */
const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");

if (existsSync(envFile)) {
  const preset = { ...process.env };
  process.loadEnvFile(envFile);
  for (const [key, value] of Object.entries(preset)) process.env[key] = value;
  console.log("已載入 .env 設定檔。");
}
