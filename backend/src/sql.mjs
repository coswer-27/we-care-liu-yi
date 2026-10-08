/**
 * 資料庫轉接層。
 *
 * 設定了 TURSO_DATABASE_URL + TURSO_AUTH_TOKEN 時走 Turso（libSQL 的 HTTP API，
 * 用內建 fetch 呼叫，不需要任何 npm 套件）；否則用本機的 node:sqlite 檔案。
 *
 * 兩種驅動都提供同一組「非同步」介面：exec / all / get / run / batch。
 * Turso 是 SQLite 相容的，所以兩邊的 SQL 完全一樣。
 *
 * 為什麼需要它：Render 免費方案的檔案系統是暫時的，服務一休眠（閒置 15 分鐘）
 * 本機 SQLite 檔就會消失，使用者帳號與海龜進度也跟著不見。
 */

const TURSO_URL = (process.env.TURSO_DATABASE_URL || "").trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || "").trim();

export const driver = TURSO_URL && TURSO_TOKEN ? "turso" : "sqlite";

/** 把一段含多個敘述的 SQL 切成單一敘述（我們的 schema 內沒有含分號的字串常值）。 */
function splitStatements(sqlText) {
  return sqlText
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------- Turso

/** 把 JS 值轉成 libSQL 的值表示法。 */
function toValue(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "boolean") return { type: "integer", value: value ? "1" : "0" };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value };
  }
  if (typeof value === "bigint") return { type: "integer", value: String(value) };
  return { type: "text", value: String(value) };
}

function fromValue(value) {
  switch (value.type) {
    case "null":
      return null;
    case "integer":
      return Number(value.value);
    case "float":
      return value.value;
    case "blob":
      return Buffer.from(value.base64, "base64");
    default:
      return value.value;
  }
}

function toStatement({ sql, params }) {
  const named = Object.entries(params || {}).map(([name, value]) => ({ name, value: toValue(value) }));
  return named.length ? { sql, named_args: named } : { sql };
}

function decodeResult(result) {
  const cols = result.cols.map((col) => col.name);
  return {
    rows: result.rows.map((row) => Object.fromEntries(row.map((cell, i) => [cols[i], fromValue(cell)]))),
    changes: result.affected_row_count ?? 0,
    lastInsertRowid: result.last_insert_rowid ? Number(result.last_insert_rowid) : null
  };
}

const endpoint = `${TURSO_URL.replace(/^libsql:\/\//, "https://").replace(/\/+$/, "")}/v2/pipeline`;

/** 一次 HTTP 來回送出多個敘述，依序在同一個連線上執行。 */
async function tursoPipeline(statements) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [...statements.map((stmt) => ({ type: "execute", stmt })), { type: "close" }]
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Turso HTTP ${response.status}：${(await response.text()).slice(0, 200)}`);
  }

  const data = await response.json();
  const failed = data.results.find((item) => item.type === "error");
  if (failed) throw new Error(`Turso：${failed.error?.message || "unknown error"}`);

  return data.results
    .filter((item) => item.response?.type === "execute")
    .map((item) => decodeResult(item.response.result));
}

// ---------------------------------------------------------------- node:sqlite

let localDb = null;

async function localDatabase() {
  if (localDb) return localDb;

  const { mkdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { DatabaseSync } = await import("node:sqlite");

  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath = process.env.DB_PATH || join(here, "..", "data", "app.db");
  mkdirSync(dirname(dbPath), { recursive: true });

  localDb = new DatabaseSync(dbPath);
  localDb.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return localDb;
}

// ---------------------------------------------------------------- 對外介面

/** 執行一段可能含多個敘述的 SQL（建表、刪表等）。 */
export async function exec(sqlText) {
  const statements = splitStatements(sqlText);
  if (!statements.length) return;

  if (driver === "turso") {
    await tursoPipeline(statements.map((sql) => ({ sql })));
    return;
  }
  const db = await localDatabase();
  for (const sql of statements) db.exec(sql);
}

export async function all(sql, params = {}) {
  if (driver === "turso") {
    const [result] = await tursoPipeline([toStatement({ sql, params })]);
    return result.rows;
  }
  const db = await localDatabase();
  return db.prepare(sql).all(params);
}

export async function get(sql, params = {}) {
  const rows = await all(sql, params);
  return rows[0];
}

export async function run(sql, params = {}) {
  if (driver === "turso") {
    const [result] = await tursoPipeline([toStatement({ sql, params })]);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }
  const db = await localDatabase();
  const result = db.prepare(sql).run(params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

/**
 * 一次送出多個敘述。Turso 只花一次 HTTP 來回，seed 與首頁查詢靠這個避免大量往返。
 * @param {{sql:string, params?:object}[]} items
 * @returns {Promise<object[][]>} 每個敘述對應的資料列
 */
export async function batch(items) {
  if (!items.length) return [];

  if (driver === "turso") {
    const results = await tursoPipeline(items.map(toStatement));
    return results.map((result) => result.rows);
  }
  const db = await localDatabase();
  return items.map((item) => db.prepare(item.sql).all(item.params || {}));
}

export function describeDriver() {
  if (driver === "turso") {
    const host = endpoint.replace(/^https:\/\//, "").replace("/v2/pipeline", "");
    return `Turso（${host}）— 資料永久保存`;
  }
  return `本機 SQLite 檔案（${process.env.DB_PATH || "backend/data/app.db"}）`;
}
