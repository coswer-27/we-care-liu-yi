/**
 * 地圖抽象層。
 *
 * 有 Google Maps 瀏覽器金鑰時使用 Google Maps JavaScript API；
 * 沒有金鑰時自動退回 Leaflet + OpenStreetMap，讓所有需要地圖的頁面都能正常運作。
 * 兩種實作都提供同一組方法：render({ markers, path, fit })。
 */

const ISLAND_CENTER = { lat: 22.3428, lng: 120.3736 };
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

let providerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.async = true;
    tag.onload = resolve;
    tag.onerror = () => reject(new Error(`無法載入 ${src}`));
    document.head.appendChild(tag);
  });
}

function loadStylesheet(href) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/** 解碼 Google 的 encoded polyline。 */
export function decodePolyline(encoded) {
  if (!encoded) return [];
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

async function loadGoogle(key) {
  if (!window.google?.maps) {
    await loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=zh-TW&region=TW`);
  }
  return {
    name: "google",
    create(container) {
      const map = new google.maps.Map(container, {
        center: ISLAND_CENTER,
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "cooperative"
      });
      const info = new google.maps.InfoWindow();
      let overlays = [];

      const clear = () => {
        overlays.forEach((item) => item.setMap(null));
        overlays = [];
      };

      return {
        render({ markers = [], path = [], fit = true }) {
          clear();
          const bounds = new google.maps.LatLngBounds();

          markers.forEach((item, index) => {
            const marker = new google.maps.Marker({
              position: { lat: item.lat, lng: item.lng },
              map,
              title: item.name,
              label: markers.length > 1 && item.ordered ? String(index + 1) : undefined
            });
            marker.addListener("click", () => {
              info.setContent(`<strong>${item.name}</strong><br />${item.description || ""}`);
              info.open(map, marker);
            });
            overlays.push(marker);
            bounds.extend(marker.getPosition());
          });

          if (path.length > 1) {
            const line = new google.maps.Polyline({
              path,
              map,
              strokeColor: "#0f766e",
              strokeOpacity: 0.9,
              strokeWeight: 5
            });
            overlays.push(line);
            path.forEach((point) => bounds.extend(point));
          }

          if (fit && !bounds.isEmpty()) {
            map.fitBounds(bounds, 48);
          }
        }
      };
    }
  };
}

async function loadLeaflet() {
  if (!window.L) {
    loadStylesheet(LEAFLET_CSS);
    await loadScript(LEAFLET_JS);
  }
  return {
    name: "leaflet",
    create(container) {
      const map = L.map(container, { scrollWheelZoom: false }).setView([ISLAND_CENTER.lat, ISLAND_CENTER.lng], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);

      const layer = L.layerGroup().addTo(map);

      return {
        render({ markers = [], path = [], fit = true }) {
          layer.clearLayers();
          const bounds = [];

          markers.forEach((item, index) => {
            const label = markers.length > 1 && item.ordered ? `${index + 1}. ` : "";
            L.marker([item.lat, item.lng])
              .bindPopup(`<strong>${label}${item.name}</strong><br />${item.description || ""}`)
              .addTo(layer);
            bounds.push([item.lat, item.lng]);
          });

          if (path.length > 1) {
            const latlngs = path.map((p) => [p.lat, p.lng]);
            L.polyline(latlngs, { color: "#0f766e", weight: 5, opacity: 0.9 }).addTo(layer);
            bounds.push(...latlngs);
          }

          if (fit && bounds.length) {
            map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
          }
          setTimeout(() => map.invalidateSize(), 60);
        }
      };
    }
  };
}

/** 依設定選擇地圖供應者，只載入一次。 */
export function mapProvider(config) {
  if (!providerPromise) {
    providerPromise = (config.mapsBrowserKey ? loadGoogle(config.mapsBrowserKey) : loadLeaflet()).catch((error) => {
      console.warn("地圖載入失敗", error);
      return null;
    });
  }
  return providerPromise;
}

/**
 * 在容器上建立地圖並繪製內容。容器若尚未顯示（例如在隱藏的分頁中）會延後初始化。
 */
export async function drawMap(container, config, payload) {
  const provider = await mapProvider(config);
  if (!provider) {
    container.innerHTML = '<p class="map-fallback">地圖暫時無法載入，可改用下方的「開啟導航」按鈕。</p>';
    return null;
  }
  if (!container._mapInstance) {
    container._mapInstance = provider.create(container);
  }
  container._mapInstance.render(payload);
  return container._mapInstance;
}

/** 產生 Google Maps 導航連結（不需要金鑰）。 */
export function navigationLink(points, travelMode = "driving") {
  const coord = (p) => `${p.lat},${p.lng}`;
  const params = new URLSearchParams({
    api: "1",
    origin: coord(points[0]),
    destination: coord(points[points.length - 1]),
    travelmode: travelMode
  });
  const middle = points.slice(1, -1);
  if (middle.length) params.set("waypoints", middle.map(coord).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}

/** 單一地點的導航連結。 */
export function navigateToLink(point) {
  const params = new URLSearchParams({ api: "1", destination: `${point.lat},${point.lng}` });
  return `https://www.google.com/maps/dir/?${params}`;
}
