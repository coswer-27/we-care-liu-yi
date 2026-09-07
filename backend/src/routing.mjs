/**
 * 路線與距離計算。
 *
 * 依序嘗試，第一個成功的就採用；全部失敗才用離線推估。
 * 四種來源回傳同一種結構，前端不需要知道實際用了哪一個。
 *
 *   1. Google Routes API v2      需要 GOOGLE_MAPS_API_KEY（要信用卡／計費帳戶）
 *   2. Google Directions API     同一把金鑰，給只有舊版 API 的專案用
 *   3. OpenRouteService          需要 ORS_API_KEY（免費註冊，不用信用卡）
 *   4. OSRM 公開伺服器           不需要任何金鑰，開箱即用
 *   5. Haversine × 彎繞係數      完全離線的最後備援
 *
 * 可用 ROUTING_PROVIDER 指定只用其中一種：google / ors / osrm / estimate。
 */

const ROAD_FACTOR = 1.3; // 小琉球環島公路相對直線距離的概略彎繞係數
const SPEED_KMH = { walking: 4.5, bicycling: 13, driving: 25 };
const OSRM_BASE = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
const TIMEOUT_MS = 8000;

export function apiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || "";
}

export function orsKey() {
  return process.env.ORS_API_KEY || "";
}

function preferred() {
  return (process.env.ROUTING_PROVIDER || "").trim().toLowerCase();
}

/** 目前實際會用到的路線來源，開機訊息與 /api/config 用。 */
export function routingMode() {
  const forced = preferred();
  if (forced) return forced;
  if (apiKey()) return "google";
  if (orsKey()) return "ors";
  return "osrm";
}

export function hasDirections() {
  return routingMode() !== "estimate";
}

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 依交通方式與距離估算時間，用於本身不分運具的路線來源。 */
function minutesFor(km, googleMode) {
  return Math.max(1, Math.round((km / (SPEED_KMH[googleMode] || SPEED_KMH.driving)) * 60));
}

function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

function buildResult(source, points, legDistances, legDurations, polyline) {
  const legs = legDistances.map((km, index) => ({
    from: points[index].name,
    to: points[index + 1].name,
    distanceKm: Number(km.toFixed(2)),
    durationMin: legDurations[index]
  }));
  return {
    source,
    legs,
    distanceKm: Number(legs.reduce((sum, leg) => sum + leg.distanceKm, 0).toFixed(2)),
    durationMin: legs.reduce((sum, leg) => sum + leg.durationMin, 0),
    polyline: polyline || null
  };
}

// ---------------------------------------------------------------- 各來源

function estimateRoute(points, googleMode) {
  const distances = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    distances.push(haversineKm(points[i], points[i + 1]) * ROAD_FACTOR);
  }
  return buildResult(
    "estimate",
    points,
    distances,
    distances.map((km) => minutesFor(km, googleMode)),
    null
  );
}

const ROUTES_TRAVEL_MODE = { walking: "WALK", bicycling: "BICYCLE", driving: "DRIVE" };

async function routesApi(points, googleMode) {
  const toWaypoint = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const response = await fetchWithTimeout("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask":
        "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration"
    },
    body: JSON.stringify({
      origin: toWaypoint(points[0]),
      destination: toWaypoint(points[points.length - 1]),
      intermediates: points.slice(1, -1).map(toWaypoint),
      travelMode: ROUTES_TRAVEL_MODE[googleMode] || "DRIVE",
      polylineEncoding: "ENCODED_POLYLINE",
      languageCode: "zh-TW",
      units: "METRIC"
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Routes API ${response.status}`);

  const route = data.routes?.[0];
  if (!route) throw new Error("Routes API 沒有回傳路線");

  const seconds = (value) => Number(String(value || "0s").replace("s", ""));
  const legs = route.legs || [];
  return buildResult(
    "google-routes",
    points,
    legs.map((leg) => (leg.distanceMeters || 0) / 1000),
    legs.map((leg) => Math.max(1, Math.round(seconds(leg.duration) / 60))),
    route.polyline?.encodedPolyline
  );
}

async function legacyDirections(points, googleMode) {
  const coord = (p) => `${p.lat},${p.lng}`;
  const params = new URLSearchParams({
    origin: coord(points[0]),
    destination: coord(points[points.length - 1]),
    mode: googleMode,
    language: "zh-TW",
    key: apiKey()
  });
  const middle = points.slice(1, -1);
  if (middle.length) params.set("waypoints", middle.map(coord).join("|"));

  const response = await fetchWithTimeout(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
  const data = await response.json();
  if (data.status !== "OK") throw new Error(data.error_message || `Directions API ${data.status}`);

  const route = data.routes[0];
  return buildResult(
    "google-directions",
    points,
    route.legs.map((leg) => leg.distance.value / 1000),
    route.legs.map((leg) => Math.max(1, Math.round(leg.duration.value / 60))),
    route.overview_polyline?.points
  );
}

const ORS_PROFILE = {
  walking: "foot-walking",
  bicycling: "cycling-regular",
  driving: "driving-car"
};

/** OpenRouteService：免費註冊即可拿金鑰，不需要信用卡，且真的區分運具。 */
async function openRouteService(points, googleMode) {
  const profile = ORS_PROFILE[googleMode] || ORS_PROFILE.driving;
  const response = await fetchWithTimeout(`https://api.openrouteservice.org/v2/directions/${profile}`, {
    method: "POST",
    headers: { Authorization: orsKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: points.map((p) => [p.lng, p.lat]) })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenRouteService ${response.status}`);

  const route = data.routes?.[0];
  if (!route) throw new Error("OpenRouteService 沒有回傳路線");

  // segments 的數量等於點位數 - 1，剛好對應每一段。
  const segments = route.segments || [];
  return buildResult(
    "openrouteservice",
    points,
    segments.map((segment) => segment.distance / 1000),
    segments.map((segment) => Math.max(1, Math.round(segment.duration / 60))),
    route.geometry
  );
}

/**
 * OSRM 公開伺服器：不需要金鑰。
 * 公開的 demo 只跑汽車路網，所以距離採用它的實際道路里程，
 * 時間則依交通方式自行換算（小琉球步行與單車走的是同一批道路，誤差可接受）。
 */
async function osrm(points, googleMode) {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const response = await fetchWithTimeout(
    `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=polyline`
  );
  const data = await response.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(data.message || `OSRM ${data.code || response.status}`);
  }

  const route = data.routes[0];
  const distances = (route.legs || []).map((leg) => leg.distance / 1000);
  return buildResult(
    "osrm",
    points,
    distances,
    distances.map((km) => minutesFor(km, googleMode)),
    route.geometry
  );
}

// ---------------------------------------------------------------- 對外

function providerChain() {
  const forced = preferred();
  const google = apiKey() ? [routesApi, legacyDirections] : [];
  const ors = orsKey() ? [openRouteService] : [];

  if (forced === "google") return google;
  if (forced === "ors") return ors;
  if (forced === "osrm") return [osrm];
  if (forced === "estimate") return [];
  return [...google, ...ors, osrm];
}

/**
 * @param {{name:string, lat:number, lng:number}[]} points 依序經過的點位（至少兩個）
 * @param {string} googleMode walking | bicycling | driving
 */
export async function planRoute(points, googleMode) {
  if (points.length < 2) throw new Error("路線至少需要兩個點位。");

  const failures = [];
  for (const provider of providerChain()) {
    try {
      return await provider(points, googleMode);
    } catch (error) {
      failures.push(error.message);
    }
  }

  const estimate = estimateRoute(points, googleMode);
  if (!failures.length) {
    return { ...estimate, notice: "目前使用直線推估距離，未串接線上路線服務。" };
  }
  return { ...estimate, notice: `線上路線服務暫時無法使用（${failures[0]}），已改用直線推估值。` };
}

/** 產生 Google Maps 導航連結，這個連結不需要 API 金鑰。 */
export function navigationUrl(points, googleMode) {
  const coord = (p) => `${p.lat},${p.lng}`;
  const params = new URLSearchParams({
    api: "1",
    origin: coord(points[0]),
    destination: coord(points[points.length - 1]),
    travelmode: googleMode === "bicycling" ? "bicycling" : googleMode === "walking" ? "walking" : "driving"
  });
  const middle = points.slice(1, -1);
  if (middle.length) params.set("waypoints", middle.map(coord).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}
