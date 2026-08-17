import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import { all, get, migrate } from "./db.mjs";
import { seed } from "./seed.mjs";

const PORT = Number(process.env.PORT || 4000);
const baselineScooterKgPerKm = 0.075;
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "..", "frontend", "public");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(publicDir, requestedPath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return false;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(res);
  return true;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function calculateDistanceKm(start, end) {
  const diff = Math.abs(start.distance_order - end.distance_order);
  return Number((Math.max(0.8, diff * 0.65)).toFixed(1));
}

async function handle(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ok: true, service: "liu-yi-api" });
  }

  if (req.method === "GET" && url.pathname === "/api/home") {
    return send(res, 200, {
      places: all("SELECT * FROM places ORDER BY distance_order"),
      modes: all("SELECT * FROM transport_modes ORDER BY kg_co2_per_km"),
      shops: all("SELECT * FROM sustainable_shops ORDER BY id"),
      actions: all("SELECT * FROM plastic_actions ORDER BY points DESC"),
      articles: all("SELECT * FROM articles ORDER BY published_at DESC")
    });
  }

  if (req.method === "POST" && url.pathname === "/api/carbon/calculate") {
    const body = await parseBody(req);
    const start = get("SELECT * FROM places WHERE id = :id", { id: Number(body.startPlaceId) });
    const end = get("SELECT * FROM places WHERE id = :id", { id: Number(body.endPlaceId) });
    const mode = get("SELECT * FROM transport_modes WHERE id = :id", { id: String(body.transportModeId || "") });

    if (!start || !end || !mode) {
      return send(res, 400, { error: "請選擇有效的起點、終點與交通方式。" });
    }

    const distanceKm = calculateDistanceKm(start, end);
    const estimatedKg = Number((distanceKm * mode.kg_co2_per_km).toFixed(2));
    const baselineKg = distanceKm * baselineScooterKgPerKm;
    const savedKg = Number(Math.max(0, baselineKg - estimatedKg).toFixed(2));
    const points = Math.round(savedKg * mode.points_per_kg_saved);
    const turtleLife = Math.min(1000, points);

    return send(res, 200, {
      route: { start: start.name, end: end.name, distanceKm },
      mode: { id: mode.id, name: mode.name },
      estimatedKg,
      savedKg,
      points,
      turtleLife,
      message: points > 0 ? "低碳行動已轉換為海龜生命值。" : "這趟旅程仍可嘗試更低碳的交通方式。"
    });
  }

  if (url.pathname.startsWith("/api/")) {
    return send(res, 404, { error: "API route not found" });
  }

  if (!sendStatic(req, res)) {
    send(res, 404, { error: "Page not found" });
  }
}

migrate();
seed();

createServer((req, res) => {
  handle(req, res).catch((error) => {
    send(res, 500, { error: error.message || "Server error" });
  });
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
