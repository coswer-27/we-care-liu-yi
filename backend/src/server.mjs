import "./env.mjs"; // 必須排在最前面：其他模組在載入時就會讀 process.env
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { all, get, migrate, run } from "./db.mjs";
import { seed } from "./seed.mjs";
import {
  clearedCookie,
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  readSessionToken,
  sessionCookie,
  validateCredentials,
  verifyPassword
} from "./auth.mjs";
import { hasDirections, navigationUrl, planRoute, routingMode } from "./routing.mjs";
import { actionDoneToday, addAction, addTrip, historyFor, progressFor } from "./turtle.mjs";

const PORT = Number(process.env.PORT || 4000);
/** 減碳基準：一般燃油機車。savedKg 就是相對這個基準省下的排碳量。 */
const BASELINE_KG_PER_KM = 0.075;
const MAX_ROUTE_POINTS = 12;

const ROUTING_LABEL = {
  google: "Google Routes API（已設定金鑰）",
  ors: "OpenRouteService（已設定金鑰）",
  osrm: "OSRM 公開伺服器（免金鑰，實際道路距離）",
  estimate: "直線推估（未串接線上服務）"
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "..", "frontend", "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function isSecure(req) {
  return (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function send(req, res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...corsHeaders(req),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(body);
}

function sendStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(publicDir, requested));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=300"
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
    req.on("error", reject);
  });
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name };
}

/** 依距離與交通方式算出排碳、減碳與可得點數。 */
function carbonFor(distanceKm, mode) {
  const estimatedKg = Number((distanceKm * mode.kg_co2_per_km).toFixed(2));
  const savedKg = Number(Math.max(0, distanceKm * BASELINE_KG_PER_KM - estimatedKg).toFixed(2));
  return { estimatedKg, savedKg, points: Math.round(savedKg * mode.points_per_kg_saved) };
}

function modeComparison(distanceKm) {
  return all("SELECT * FROM transport_modes ORDER BY kg_co2_per_km").map((mode) => ({
    id: mode.id,
    name: mode.name,
    icon: mode.icon,
    ...carbonFor(distanceKm, mode)
  }));
}

function loadPlaces(ids) {
  return ids.map((id) => get("SELECT * FROM places WHERE id = :id", { id: Number(id) })).filter(Boolean);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  // ---------- 基礎 ----------

  if (method === "GET" && pathname === "/api/health") {
    return send(req, res, 200, { ok: true, service: "liu-yi-api" });
  }

  if (method === "GET" && pathname === "/api/config") {
    return send(req, res, 200, {
      // Maps JavaScript API 的金鑰一定會出現在瀏覽器，請在 Google Cloud 主控台
      // 以 HTTP referrer 限制網域，並且和後端的 Directions 金鑰分開管理。
      mapsBrowserKey: process.env.GOOGLE_MAPS_BROWSER_KEY || "",
      hasDirections: hasDirections(),
      routingMode: routingMode(),
      island: { lat: 22.3428, lng: 120.3736, zoom: 14 }
    });
  }

  // ---------- 內容 ----------

  if (method === "GET" && pathname === "/api/home") {
    return send(req, res, 200, {
      places: all("SELECT * FROM places ORDER BY distance_order"),
      modes: all("SELECT * FROM transport_modes ORDER BY kg_co2_per_km"),
      shops: all("SELECT * FROM sustainable_shops ORDER BY category, id"),
      actions: all("SELECT * FROM plastic_actions ORDER BY points DESC"),
      articles: all("SELECT * FROM articles ORDER BY published_at DESC")
    });
  }

  if (method === "GET" && pathname === "/api/places") {
    return send(req, res, 200, { places: all("SELECT * FROM places ORDER BY distance_order") });
  }

  if (method === "GET" && pathname === "/api/shops") {
    const category = url.searchParams.get("category");
    const shops = category
      ? all("SELECT * FROM sustainable_shops WHERE category = :category ORDER BY id", { category })
      : all("SELECT * FROM sustainable_shops ORDER BY category, id");
    return send(req, res, 200, { shops });
  }

  if (method === "GET" && pathname === "/api/articles") {
    return send(req, res, 200, { articles: all("SELECT * FROM articles ORDER BY published_at DESC") });
  }

  // ---------- 帳號 ----------

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const displayName = String(body.displayName || "").trim();
    const errors = validateCredentials({ email, password: body.password, displayName }, { requireName: true });
    if (errors.length) return send(req, res, 400, { error: errors[0] });

    if (get("SELECT id FROM users WHERE email = :email", { email })) {
      return send(req, res, 409, { error: "這個電子郵件已經註冊過了。" });
    }

    const { hash, salt } = hashPassword(body.password);
    run(
      `INSERT INTO users (email, display_name, password_hash, password_salt, created_at)
       VALUES (:email, :display_name, :hash, :salt, :now)`,
      { email, display_name: displayName, hash, salt, now: new Date().toISOString() }
    );

    const user = get("SELECT * FROM users WHERE email = :email", { email });
    const { token, expires } = createSession(user.id);
    return send(
      req,
      res,
      201,
      { user: publicUser(user), turtle: progressFor(user.id) },
      { "Set-Cookie": sessionCookie(token, expires, isSecure(req)) }
    );
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const user = get("SELECT * FROM users WHERE email = :email", { email });

    if (!user || !verifyPassword(String(body.password || ""), user.password_hash, user.password_salt)) {
      return send(req, res, 401, { error: "電子郵件或密碼不正確。" });
    }

    const { token, expires } = createSession(user.id);
    return send(
      req,
      res,
      200,
      { user: publicUser(user), turtle: progressFor(user.id) },
      { "Set-Cookie": sessionCookie(token, expires, isSecure(req)) }
    );
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    destroySession(readSessionToken(req));
    return send(req, res, 200, { ok: true }, { "Set-Cookie": clearedCookie(isSecure(req)) });
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    const user = currentUser(req);
    if (!user) return send(req, res, 200, { user: null });
    return send(req, res, 200, { user: publicUser(user), turtle: progressFor(user.id) });
  }

  // ---------- 海龜養成（需登入） ----------

  if (pathname.startsWith("/api/turtle")) {
    const user = currentUser(req);
    if (!user) return send(req, res, 401, { error: "請先登入才能查看海龜養成計畫。" });

    if (method === "GET" && pathname === "/api/turtle") {
      return send(req, res, 200, {
        user: publicUser(user),
        turtle: progressFor(user.id),
        history: historyFor(user.id)
      });
    }

    if (method === "POST" && pathname === "/api/turtle/actions") {
      const body = await parseBody(req);
      const action = get("SELECT * FROM plastic_actions WHERE id = :id", { id: Number(body.actionId) });
      if (!action) return send(req, res, 400, { error: "找不到這個減塑行動。" });
      if (actionDoneToday(user.id, action.id)) {
        return send(req, res, 409, { error: "今天已經完成過這項行動了，明天再來吧！" });
      }
      return send(req, res, 200, {
        turtle: addAction(user.id, action),
        message: `完成「${action.title}」，海龜生命值增加了。`
      });
    }

    return send(req, res, 404, { error: "API route not found" });
  }

  // ---------- 碳足跡與路線 ----------

  if (method === "POST" && pathname === "/api/carbon/calculate") {
    const body = await parseBody(req);
    const points = loadPlaces([body.startPlaceId, body.endPlaceId]);
    const mode = get("SELECT * FROM transport_modes WHERE id = :id", { id: String(body.transportModeId || "") });

    if (points.length !== 2 || !mode) {
      return send(req, res, 400, { error: "請選擇有效的起點、終點與交通方式。" });
    }
    if (points[0].id === points[1].id) {
      return send(req, res, 400, { error: "起點與終點不能是同一個地方。" });
    }

    const route = await planRoute(points, mode.google_mode);
    const carbon = carbonFor(route.distanceKm, mode);
    const user = currentUser(req);
    const summary = `${points[0].name} → ${points[1].name}`;

    return send(req, res, 200, {
      route: {
        summary,
        points: points.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, lat: p.lat, lng: p.lng })),
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
        legs: route.legs,
        polyline: route.polyline,
        source: route.source,
        notice: route.notice || null,
        navigationUrl: navigationUrl(points, mode.google_mode)
      },
      mode: { id: mode.id, name: mode.name, icon: mode.icon },
      ...carbon,
      comparison: modeComparison(route.distanceKm),
      turtle: user ? addTrip(user.id, { summary, modeId: mode.id, distanceKm: route.distanceKm, ...carbon }) : null,
      saved: Boolean(user),
      message: user
        ? carbon.points > 0
          ? "低碳行動已記錄，海龜生命值增加了。"
          : "這趟旅程已記錄，換個更低碳的交通方式可以獲得點數。"
        : "登入後就能把這趟行程累積到你的海龜養成計畫。"
    });
  }

  if (method === "POST" && pathname === "/api/routes/plan") {
    const body = await parseBody(req);
    const ids = Array.isArray(body.placeIds) ? body.placeIds.slice(0, MAX_ROUTE_POINTS) : [];
    const points = loadPlaces(ids);
    const mode = get("SELECT * FROM transport_modes WHERE id = :id", { id: String(body.transportModeId || "") });

    if (points.length < 2) return send(req, res, 400, { error: "請至少選擇兩個點位。" });
    if (points.length !== ids.length) return send(req, res, 400, { error: "路線中有無效的點位。" });
    if (!mode) return send(req, res, 400, { error: "請選擇交通方式。" });

    const route = await planRoute(points, mode.google_mode);
    const carbon = carbonFor(route.distanceKm, mode);
    const user = currentUser(req);
    const summary = points.map((p) => p.name).join(" → ");
    const shouldSave = Boolean(user) && body.save === true;

    return send(req, res, 200, {
      route: {
        summary,
        points: points.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, lat: p.lat, lng: p.lng })),
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
        legs: route.legs,
        polyline: route.polyline,
        source: route.source,
        notice: route.notice || null,
        navigationUrl: navigationUrl(points, mode.google_mode)
      },
      mode: { id: mode.id, name: mode.name, icon: mode.icon },
      ...carbon,
      comparison: modeComparison(route.distanceKm),
      turtle: shouldSave ? addTrip(user.id, { summary, modeId: mode.id, distanceKm: route.distanceKm, ...carbon }) : null,
      saved: shouldSave,
      canSave: Boolean(user)
    });
  }

  if (pathname.startsWith("/api/")) {
    return send(req, res, 404, { error: "API route not found" });
  }

  // ---------- 靜態檔案 ----------

  if (!sendStatic(req, res)) {
    // 前端是 hash 路由的單頁應用，未知路徑一律回首頁。
    req.url = "/index.html";
    if (!sendStatic(req, res)) send(req, res, 404, { error: "Page not found" });
  }
}

migrate();
seed();

createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) send(req, res, 500, { error: error.message || "Server error" });
  });
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`路線來源：${ROUTING_LABEL[routingMode()] || routingMode()}`);
});
