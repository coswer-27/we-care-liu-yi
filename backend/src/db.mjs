import { all, batch, describeDriver, driver, exec, get, run } from "./sql.mjs";

export { all, batch, describeDriver, driver, exec, get, run };

// 內容表（景點、店家、行動、文章…）的結構版本。改動這些表的欄位時把數字 +1，
// 啟動時就會自動重建並重新 seed。使用者資料表（users / sessions / 進度 / 紀錄）永遠不動。
const CONTENT_SCHEMA_VERSION = 5;
const CONTENT_TABLES = ["places", "transport_modes", "sustainable_shops", "plastic_actions", "articles"];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    emoji TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    lat REAL NOT NULL DEFAULT 0,
    lng REAL NOT NULL DEFAULT 0,
    distance_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transport_modes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    google_mode TEXT NOT NULL DEFAULT 'driving',
    kg_co2_per_km REAL NOT NULL,
    points_per_kg_saved INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sustainable_shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'farm',
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    hours TEXT NOT NULL DEFAULT '',
    lat REAL NOT NULL DEFAULT 0,
    lng REAL NOT NULL DEFAULT 0,
    tags TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plastic_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    points INTEGER NOT NULL,
    co2_saved_kg REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    summary TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS turtle_progress (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_points INTEGER NOT NULL DEFAULT 0,
    total_saved_kg REAL NOT NULL DEFAULT 0,
    trip_count INTEGER NOT NULL DEFAULT 0,
    action_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trip_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    mode_id TEXT NOT NULL,
    distance_km REAL NOT NULL,
    estimated_kg REAL NOT NULL,
    saved_kg REAL NOT NULL,
    points INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    points INTEGER NOT NULL,
    co2_saved_kg REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trip_logs_user ON trip_logs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_action_logs_user ON action_logs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

async function resetContentTablesIfOutdated() {
  await exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  const row = await get("SELECT value FROM schema_meta WHERE key = 'content_version'");
  if (row && Number(row.value) === CONTENT_SCHEMA_VERSION) return;

  await exec(CONTENT_TABLES.map((table) => `DROP TABLE IF EXISTS ${table}`).join(";"));
  await run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('content_version', :value)", {
    value: String(CONTENT_SCHEMA_VERSION)
  });
}

export async function migrate() {
  await resetContentTablesIfOutdated();
  await exec(SCHEMA);
}
