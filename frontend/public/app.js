import { decodePolyline, drawMap, navigateToLink } from "./map.js";

const API_BASE =
  window.location.port === "5173" ? "http://localhost:4000/api" : `${window.location.origin}/api`;

const state = {
  config: { mapsBrowserKey: "", hasDirections: false },
  home: null,
  user: null,
  turtle: null,
  /** 自訂路線目前選到的點位 id（至少兩個）。 */
  routePoints: [],
  actionsTab: "farm"
};

const SHOP_TABS = [
  { id: "farm", label: "在地小農店家", emoji: "🥬", blurb: "支持在地生產，縮短食物里程，減少運輸與包裝碳排。" },
  { id: "bowl", label: "咕咕碗租借點", emoji: "🍚", blurb: "以環保餐盒取代免洗餐具，甲地借、乙地還。" },
  { id: "cup", label: "琉行杯租借點", emoji: "🥤", blurb: "全島超過 80 處租借點，讓手搖飲不再產生一次性杯。" },
  { id: "ev", label: "電動車出租站", emoji: "🛵", blurb: "以電動機車與電輔自行車取代燃油機車，快充站遍布環島路線。" }
];

const PRESET_ROUTES = [
  { name: "北岸散步線", emoji: "🚶", modeId: "walk", places: ["白沙尾觀光港", "花瓶岩", "中澳沙灘", "三民老街"] },
  { name: "西岸夕陽線", emoji: "🚲", modeId: "bike", places: ["三民老街", "肚仔坪潮間帶", "蛤板灣（威尼斯沙灘）", "落日亭"] },
  { name: "南環生態線", emoji: "⚡", modeId: "electric_scooter", places: ["白沙尾觀光港", "山豬溝", "烏鬼洞", "觀音石", "白燈塔（琉球嶼燈塔）"] },
  { name: "東岸日出線", emoji: "🚲", modeId: "bike", places: ["白沙尾觀光港", "旭日亭", "紅番石", "龍蝦洞"] }
];

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** 轉義使用者可見字串，避免把資料當成 HTML 解析。 */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `伺服器錯誤（${response.status}）`);
  return data;
}

let toastTimer = null;
function toast(message, tone = "info") {
  const el = $("#toast");
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3600);
}

function placeById(id) {
  return state.home.places.find((place) => place.id === Number(id));
}

function placeByName(name) {
  return state.home.places.find((place) => place.name === name);
}

function modeById(id) {
  return state.home.modes.find((mode) => mode.id === id);
}

// ---------------------------------------------------------------- 共用片段

function turtleMeter(turtle) {
  const pct = Math.round((turtle.life / turtle.maxLife) * 100);
  return `
    <div class="turtle-meter">
      <div class="turtle-meter-head">
        <span class="turtle-stage">${esc(turtle.stageEmoji)} ${esc(turtle.stage)}</span>
        <span class="turtle-life">海龜生命值 <strong>${turtle.life}</strong> / ${turtle.maxLife}</span>
      </div>
      <div class="meter" role="progressbar" aria-valuenow="${turtle.life}" aria-valuemin="0" aria-valuemax="${turtle.maxLife}">
        <span style="width:${pct}%"></span>
      </div>
      <p class="turtle-blurb">${esc(turtle.stageBlurb)}</p>
    </div>
  `;
}

function carbonResultCard(result) {
  const rows = result.comparison
    .map(
      (mode) => `
        <tr class="${mode.id === result.mode.id ? "is-current" : ""}">
          <td>${esc(mode.icon)} ${esc(mode.name)}</td>
          <td>${mode.estimatedKg} kg</td>
          <td>${mode.savedKg} kg</td>
          <td>+${mode.points}</td>
        </tr>`
    )
    .join("");

  const legs = result.route.legs
    .map((leg) => `<li>${esc(leg.from)} → ${esc(leg.to)}<span>${leg.distanceKm} km · 約 ${leg.durationMin} 分</span></li>`)
    .join("");

  return `
    <div class="result-card">
      <div class="result-head">
        <div>
          <h3>${esc(result.route.summary)}</h3>
          <p>${esc(result.mode.icon)} ${esc(result.mode.name)}｜約 ${result.route.distanceKm} km｜約 ${result.route.durationMin} 分鐘</p>
        </div>
        <a class="btn btn-primary" href="${esc(result.route.navigationUrl)}" target="_blank" rel="noopener">
          🧭 開啟導航
        </a>
      </div>

      <div class="result-stats">
        <div><small>預估排碳</small><strong>${result.estimatedKg} kg</strong><span>CO₂e</span></div>
        <div><small>相較機車減碳</small><strong>${result.savedKg} kg</strong><span>CO₂e</span></div>
        <div class="accent"><small>可獲得</small><strong>+${result.points}</strong><span>減碳點數</span></div>
      </div>

      ${legs ? `<ol class="leg-list">${legs}</ol>` : ""}

      <details class="comparison">
        <summary>換一種交通方式會差多少？</summary>
        <div class="table-scroll">
          <table>
            <thead><tr><th>交通方式</th><th>排碳</th><th>減碳</th><th>點數</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>

      ${result.route.notice ? `<p class="notice">${esc(result.route.notice)}</p>` : ""}
      ${result.message ? `<p class="result-message">${esc(result.message)}</p>` : ""}
    </div>
  `;
}

async function paintRouteMap(containerId, result) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const path = result.route.polyline
    ? decodePolyline(result.route.polyline)
    : result.route.points.map((p) => ({ lat: p.lat, lng: p.lng }));
  await drawMap(container, state.config, {
    markers: result.route.points.map((p) => ({ ...p, ordered: true, description: "" })),
    path
  });
}

function shopCard(shop) {
  const tags = shop.tags
    .split(",")
    .filter(Boolean)
    .map((tag) => `<span class="pill">${esc(tag.trim())}</span>`)
    .join("");
  return `
    <article class="list-item">
      <div class="list-item-head">
        <strong>${esc(shop.name)}</strong>
        <span class="badge">${esc(shop.type)}</span>
      </div>
      <p>${esc(shop.description)}</p>
      <dl class="meta">
        <div><dt>地址</dt><dd>${esc(shop.address)}</dd></div>
        ${shop.hours ? `<div><dt>時間</dt><dd>${esc(shop.hours)}</dd></div>` : ""}
        ${shop.phone ? `<div><dt>電話</dt><dd><a href="tel:${esc(shop.phone)}">${esc(shop.phone)}</a></dd></div>` : ""}
      </dl>
      <div class="tag-row">${tags}</div>
      <a class="btn btn-ghost btn-sm" href="${esc(navigateToLink(shop))}" target="_blank" rel="noopener">🧭 導航到這裡</a>
    </article>
  `;
}

// ---------------------------------------------------------------- 頁面

function homePage() {
  const { places, articles } = state.home;
  const highlights = places.filter((p) => p.category !== "port").slice(0, 6);

  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">低碳旅遊 × 海洋保育 × 永續未來</p>
        <h1>一起減碳 · 守護小琉球</h1>
        <p class="lede">
          開始規劃低碳路線、支持在地永續店家、計算你的碳足跡，
          每一次選擇都變成海龜的生命值，一起完成海龜養成計畫。
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/travel">開始低碳旅遊</a>
          <a class="btn btn-ghost" href="#/turtle">🐢 海龜養成計畫</a>
        </div>
      </div>
      <div class="hero-card">
        ${
          state.turtle
            ? turtleMeter(state.turtle)
            : `<div class="hero-guest">
                 <span aria-hidden="true">🥚</span>
                 <p>登入後就能開始養成你的海龜，把減碳成果一路累積下去。</p>
                 <a class="btn btn-primary btn-sm" href="#/login">登入 / 註冊</a>
               </div>`
        }
      </div>
    </section>

    <section class="feature-grid">
      <a class="feature-card" href="#/travel">
        <span class="feature-icon" aria-hidden="true">🌱</span>
        <h2>碳足跡計算</h2>
        <p>選擇起訖點與交通方式，估算旅程排碳與可獲得的減碳點數。</p>
      </a>
      <a class="feature-card" href="#/turtle">
        <span class="feature-icon" aria-hidden="true">🐢</span>
        <h2>海龜養成計畫</h2>
        <p>把減碳行動轉換成海龜生命值，一起陪牠從龜蛋長成成龜。</p>
      </a>
      <a class="feature-card" href="#/actions">
        <span class="feature-icon" aria-hidden="true">♻️</span>
        <h2>減塑行動指南</h2>
        <p>咕咕碗、琉行杯租借地圖與每日減塑行動打卡。</p>
      </a>
      <a class="feature-card" href="#/travel">
        <span class="feature-icon" aria-hidden="true">🚲</span>
        <h2>低碳路線規劃</h2>
        <p>精選路線可直接套用，也能自訂點位數量規劃專屬行程。</p>
      </a>
      <a class="feature-card" href="#/actions">
        <span class="feature-icon" aria-hidden="true">🏪</span>
        <h2>在地小農店家</h2>
        <p>農會、在地食品與漁產加工店家，用消費支持在地永續。</p>
      </a>
      <a class="feature-card" href="#/news">
        <span class="feature-icon" aria-hidden="true">📖</span>
        <h2>最新消息與環境教育</h2>
        <p>海龜保育、潮間帶管理與減塑政策的最新報導。</p>
      </a>
    </section>

    <section class="content-band">
      <div class="section-heading">
        <h2>島上有什麼可以慢慢走？</h2>
        <p>共 ${places.length} 個景點可用於碳足跡計算與路線規劃。</p>
      </div>
      <div class="place-grid">
        ${highlights
          .map(
            (place) => `
              <article class="place-card">
                <span class="place-emoji" aria-hidden="true">${esc(place.emoji)}</span>
                <strong>${esc(place.name)}</strong>
                <p>${esc(place.description)}</p>
              </article>`
          )
          .join("")}
      </div>
      <a class="btn btn-ghost" href="#/travel">查看全部景點與路線</a>
    </section>

    <section class="content-band">
      <div class="section-heading">
        <h2>最新消息</h2>
        <a class="text-link" href="#/news">更多 ›</a>
      </div>
      <div class="article-grid">
        ${articles.slice(0, 3).map(articleCard).join("")}
      </div>
    </section>
  `;
}

function aboutPage() {
  return `
    <section class="page-head">
      <h1>關於小琉球</h1>
      <p>台灣唯一的珊瑚礁島嶼，也是綠蠵龜穩定出現的海域。這裡的觀光壓力與保育之間，需要每位旅客一起分擔。</p>
    </section>

    <section class="prose-grid">
      <article class="prose-card">
        <h2>🐢 海龜之島</h2>
        <p>小琉球周邊海域是綠蠵龜重要的覓食與棲息地。與海龜相處請把握「不追逐、不接觸、不餵食」，並在夜間避免進入沙灘，以免干擾產卵。</p>
      </article>
      <article class="prose-card">
        <h2>🐚 潮間帶總量管制</h2>
        <p>杉福、漁埕尾、肚仔坪三處潮間帶為保育示範區，需付觀光保育費、依規劃路線參觀，並有每小時人數上限與休養期規定。</p>
      </article>
      <article class="prose-card">
        <h2>♻️ 島上的減塑系統</h2>
        <p>「琉行杯」與環保餐盒租借讓遊客可以甲地借、乙地還，大幅減少一次性飲料杯與免洗餐具。</p>
      </article>
      <article class="prose-card">
        <h2>⚡ 低碳運具</h2>
        <p>島上已有大量電動機車與充電站。距離短、地形平緩，步行與自行車其實就足以走完大多數景點。</p>
      </article>
    </section>

    <section class="content-band">
      <div class="section-heading">
        <h2>景點地圖</h2>
        <p>點選地圖上的標記可以查看景點說明。</p>
      </div>
      <div class="map-frame" id="aboutMap"></div>
    </section>
  `;
}

function travelPage() {
  const { places, modes } = state.home;
  const placeOptions = (selectedId) =>
    places
      .map(
        (place) =>
          `<option value="${place.id}" ${Number(selectedId) === place.id ? "selected" : ""}>${esc(place.emoji)} ${esc(place.name)}</option>`
      )
      .join("");

  return `
    <section class="page-head">
      <h1>低碳旅遊</h1>
      <p>先算算這趟路的碳足跡，再把想去的點位串成一條專屬的低碳路線。</p>
    </section>

    <section class="panel">
      <div class="section-heading">
        <h2>🌱 碳足跡計算</h2>
        <p>選擇起訖景點與交通方式，系統會依實際道路距離估算排碳量。</p>
      </div>

      <form id="carbonForm" class="stack-form">
        <div class="field-row">
          <label class="field">
            <span>起點</span>
            <select id="startPlace" required>${placeOptions(places[0]?.id)}</select>
          </label>
          <label class="field">
            <span>終點</span>
            <select id="endPlace" required>${placeOptions(places[1]?.id)}</select>
          </label>
        </div>

        <fieldset class="mode-grid">
          <legend>交通方式</legend>
          ${modes
            .map(
              (mode, index) => `
                <label class="mode-choice">
                  <input type="radio" name="transportModeId" value="${esc(mode.id)}" ${index === 0 ? "checked" : ""} />
                  <span class="mode-body">
                    <span class="mode-icon" aria-hidden="true">${esc(mode.icon)}</span>
                    <span class="mode-name">${esc(mode.name)}</span>
                    <span class="mode-rate">${mode.kg_co2_per_km} kg/km</span>
                  </span>
                </label>`
            )
            .join("")}
        </fieldset>

        <button class="btn btn-primary" type="submit">開始計算</button>
      </form>

      <div id="carbonResult" class="result-slot"></div>
      <div class="map-frame" id="carbonMap" hidden></div>
    </section>

    <section class="panel">
      <div class="section-heading">
        <h2>🚲 低碳路線規劃</h2>
        <p>可自訂點位數量（最多 12 個），排出順序後就能一次取得距離、碳排與導航。</p>
      </div>

      <div class="preset-row">
        ${PRESET_ROUTES.map(
          (preset, index) => `
            <button class="preset-chip" type="button" data-preset="${index}">
              <span aria-hidden="true">${esc(preset.emoji)}</span> ${esc(preset.name)}
              <small>${preset.places.length} 個點</small>
            </button>`
        ).join("")}
      </div>

      <div id="routeBuilder" class="route-builder"></div>

      <div class="route-controls">
        <button class="btn btn-ghost btn-sm" type="button" id="addPoint">＋ 新增點位</button>
        <label class="field inline">
          <span>交通方式</span>
          <select id="routeMode">
            ${modes.map((mode) => `<option value="${esc(mode.id)}">${esc(mode.icon)} ${esc(mode.name)}</option>`).join("")}
          </select>
        </label>
        <button class="btn btn-primary" type="button" id="planRoute">規劃路線</button>
      </div>

      <div id="routeResult" class="result-slot"></div>
      <div class="map-frame" id="routeMap" hidden></div>
    </section>
  `;
}

function actionsPage() {
  const tab = SHOP_TABS.find((item) => item.id === state.actionsTab);
  const isGuide = state.actionsTab === "guide";

  return `
    <section class="page-head">
      <h1>永續行動</h1>
      <p>把減塑與責任消費落實在行程裡：借一個杯子、支持一家小農店家，都是海龜的生命值。</p>
    </section>

    <div class="tab-bar" role="tablist">
      ${SHOP_TABS.map(
        (item) => `
          <button role="tab" class="tab ${state.actionsTab === item.id ? "is-active" : ""}"
                  data-tab="${item.id}" aria-selected="${state.actionsTab === item.id}">
            <span aria-hidden="true">${esc(item.emoji)}</span> ${esc(item.label)}
          </button>`
      ).join("")}
      <button role="tab" class="tab ${isGuide ? "is-active" : ""}" data-tab="guide" aria-selected="${isGuide}">
        <span aria-hidden="true">♻️</span> 減塑行動指南
      </button>
    </div>

    <section class="panel" id="actionsPanel">
      ${isGuide ? actionGuideSection() : shopSection(tab)}
    </section>
  `;
}

function shopSection(tab) {
  const shops = state.home.shops.filter((shop) => shop.category === tab.id);
  return `
    <div class="section-heading">
      <h2>${esc(tab.emoji)} ${esc(tab.label)}</h2>
      <p>${esc(tab.blurb)}</p>
    </div>
    <div class="map-frame" id="shopMap"></div>
    <div class="list">${shops.map(shopCard).join("") || '<p class="empty">目前尚未收錄這個分類的地點。</p>'}</div>
  `;
}

function actionGuideSection() {
  return `
    <div class="section-heading">
      <h2>♻️ 減塑行動指南</h2>
      <p>${state.user ? "每項行動每天可以完成一次，完成後直接累積到海龜生命值。" : "登入後即可打卡累積點數。"}</p>
    </div>
    <div class="list">
      ${state.home.actions
        .map(
          (action) => `
            <article class="list-item">
              <div class="list-item-head">
                <strong>${esc(action.title)}</strong>
                <span class="badge accent">+${action.points} 點</span>
              </div>
              <p>${esc(action.description)}</p>
              <div class="tag-row">
                <span class="pill">減碳 ${action.co2_saved_kg} kg</span>
              </div>
              ${
                state.user
                  ? `<button class="btn btn-ghost btn-sm" type="button" data-action-id="${action.id}">✓ 完成打卡</button>`
                  : `<a class="btn btn-ghost btn-sm" href="#/login">登入後打卡</a>`
              }
            </article>`
        )
        .join("")}
    </div>
  `;
}

function turtlePage() {
  if (!state.user) {
    return `
      <section class="page-head">
        <h1>🐢 海龜養成計畫</h1>
        <p>把每一趟低碳旅程與減塑行動，變成一隻海龜的成長紀錄。</p>
      </section>
      <section class="panel gate">
        <span class="gate-emoji" aria-hidden="true">🥚</span>
        <h2>需要登入才能開始養成</h2>
        <p>登入後你的減碳點數、生命值與行程紀錄都會被保存下來，換裝置也不會消失。</p>
        <a class="btn btn-primary" href="#/login">登入 / 註冊</a>
        <div class="gate-steps">
          <div><strong>1</strong>計算碳足跡或規劃低碳路線</div>
          <div><strong>2</strong>完成減塑行動打卡</div>
          <div><strong>3</strong>點數轉成海龜生命值，陪牠長大</div>
        </div>
      </section>
    `;
  }

  return `
    <section class="page-head">
      <h1>🐢 海龜養成計畫</h1>
      <p>${esc(state.user.displayName)}，歡迎回來。</p>
    </section>
    <section class="panel" id="turtlePanel"><p class="empty">載入中…</p></section>
  `;
}

function turtleDashboard(data) {
  const { turtle, history } = data;
  const trips = history.trips.length
    ? history.trips
        .map(
          (trip) => `
            <li>
              <div><strong>${esc(trip.summary)}</strong><small>${esc(trip.created_at.slice(0, 10))}</small></div>
              <span>${trip.distance_km} km · 減碳 ${trip.saved_kg} kg · +${trip.points}</span>
            </li>`
        )
        .join("")
    : '<li class="empty">還沒有行程紀錄，先去算一趟碳足跡吧。</li>';

  const actions = history.actions.length
    ? history.actions
        .map(
          (item) => `
            <li>
              <div><strong>${esc(item.title)}</strong><small>${esc(item.created_at.slice(0, 10))}</small></div>
              <span>+${item.points}</span>
            </li>`
        )
        .join("")
    : '<li class="empty">還沒有減塑打卡紀錄。</li>';

  return `
    <div class="turtle-hero">
      <div class="turtle-visual" aria-hidden="true">${esc(turtle.stageEmoji)}</div>
      ${turtleMeter(turtle)}
    </div>

    <div class="stat-row">
      <div><small>累積點數</small><strong>${turtle.totalPoints}</strong></div>
      <div><small>累積減碳</small><strong>${turtle.totalSavedKg} kg</strong></div>
      <div><small>行程紀錄</small><strong>${turtle.tripCount}</strong></div>
      <div><small>減塑打卡</small><strong>${turtle.actionCount}</strong></div>
    </div>

    <p class="turtle-next">
      ${
        turtle.nextStage
          ? `再 ${turtle.nextStage.life - turtle.life} 點生命值就能成長為「${esc(turtle.nextStage.name)}」。`
          : "你的海龜已經長成成龜了，繼續維持低碳旅行吧！"
      }
      還差 ${turtle.pointsToNextLife} 點就能再加 1 點生命值。
    </p>

    <div class="history-grid">
      <section>
        <h3>低碳行程</h3>
        <ul class="history-list">${trips}</ul>
      </section>
      <section>
        <h3>減塑打卡</h3>
        <ul class="history-list">${actions}</ul>
      </section>
    </div>

    <div class="turtle-cta">
      <a class="btn btn-primary" href="#/travel">再規劃一趟低碳路線</a>
      <a class="btn btn-ghost" href="#/actions">去減塑行動打卡</a>
    </div>
  `;
}

function articleCard(article) {
  return `
    <article class="article-card">
      <span class="badge">${esc(article.category)}</span>
      <strong>${esc(article.title)}</strong>
      <p>${esc(article.summary)}</p>
      <footer>
        <small>出處：${esc(article.source)}｜${esc(article.published_at)}</small>
        ${article.url ? `<a class="text-link" href="${esc(article.url)}" target="_blank" rel="noopener">閱讀原文 ›</a>` : ""}
      </footer>
    </article>
  `;
}

function newsPage() {
  return `
    <section class="page-head">
      <h1>最新消息與環境教育</h1>
      <p>以下文章皆連結至原始報導或官方公告，資料整理自公開網路來源。</p>
    </section>
    <section class="article-grid wide">
      ${state.home.articles.map(articleCard).join("")}
    </section>
  `;
}

function teamPage() {
  return `
    <section class="page-head">
      <h1>關於我們</h1>
      <p>琉行旅客團隊：吳沛瑾、李彤、楊子力、施勝維。</p>
    </section>
    <section class="prose-grid">
      <article class="prose-card">
        <h2>我們想做什麼</h2>
        <p>把「低碳旅遊」從口號變成可以量化、可以累積的日常選擇，讓旅客在規劃行程時就看得見自己的碳足跡。</p>
      </article>
      <article class="prose-card">
        <h2>從小琉球開始</h2>
        <p>島嶼尺度小、景點集中、步行與自行車可及，同時面臨明確的觀光壓力，是實踐低碳旅遊最合適的場域。</p>
      </article>
      <article class="prose-card">
        <h2>資料來源說明</h2>
        <p>碳排係數與景點座標目前為規劃階段的參考值；最新消息連結至原始報導。正式上線前會以官方公告資料校正。</p>
      </article>
      <article class="prose-card">
        <h2>聯絡我們</h2>
        <p>若你是島上的店家或單位，歡迎提供正確的據點資訊與營業時間，一起把這份地圖補完。</p>
      </article>
    </section>
  `;
}

function loginPage() {
  return `
    <section class="page-head">
      <h1>登入 / 註冊</h1>
      <p>登入後即可使用海龜養成計畫，並保存你的減碳紀錄。</p>
    </section>

    <section class="panel auth-panel">
      <div class="tab-bar compact" role="tablist">
        <button class="tab is-active" data-auth-tab="login" role="tab" aria-selected="true">登入</button>
        <button class="tab" data-auth-tab="register" role="tab" aria-selected="false">註冊</button>
      </div>

      <form id="authForm" class="stack-form" novalidate>
        <label class="field" id="nameField" hidden>
          <span>暱稱</span>
          <input type="text" name="displayName" autocomplete="nickname" maxlength="40" />
        </label>
        <label class="field">
          <span>電子郵件</span>
          <input type="email" name="email" required autocomplete="email" />
        </label>
        <label class="field">
          <span>密碼</span>
          <input type="password" name="password" required minlength="8" autocomplete="current-password" />
          <small class="hint">至少 8 個字元。</small>
        </label>
        <p class="form-error" id="authError" hidden></p>
        <button class="btn btn-primary" type="submit" id="authSubmit">登入</button>
      </form>
    </section>
  `;
}

// ---------------------------------------------------------------- 行為綁定

function bindCarbonForm() {
  const form = $("#carbonForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("button[type=submit]", form);
    button.disabled = true;
    button.textContent = "計算中…";

    try {
      const result = await api("/carbon/calculate", {
        method: "POST",
        body: {
          startPlaceId: $("#startPlace").value,
          endPlaceId: $("#endPlace").value,
          transportModeId: new FormData(form).get("transportModeId")
        }
      });

      $("#carbonResult").innerHTML = carbonResultCard(result);
      const map = $("#carbonMap");
      map.hidden = false;
      await paintRouteMap("carbonMap", result);

      if (result.turtle) {
        state.turtle = result.turtle;
        renderAccount();
        toast(`海龜生命值 ${result.turtle.life} / ${result.turtle.maxLife}`, "success");
      }
    } catch (error) {
      $("#carbonResult").innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    } finally {
      button.disabled = false;
      button.textContent = "開始計算";
    }
  });
}

function renderRouteBuilder() {
  const builder = $("#routeBuilder");
  if (!builder) return;

  builder.innerHTML = state.routePoints
    .map(
      (placeId, index) => `
        <div class="route-row">
          <span class="route-index">${index + 1}</span>
          <select data-index="${index}" aria-label="第 ${index + 1} 個點位">
            ${state.home.places
              .map(
                (place) =>
                  `<option value="${place.id}" ${place.id === placeId ? "selected" : ""}>${esc(place.emoji)} ${esc(place.name)}</option>`
              )
              .join("")}
          </select>
          <div class="route-row-actions">
            <button type="button" data-move="up" data-index="${index}" aria-label="上移" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-move="down" data-index="${index}" aria-label="下移" ${index === state.routePoints.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" data-remove="${index}" aria-label="移除" ${state.routePoints.length <= 2 ? "disabled" : ""}>✕</button>
          </div>
        </div>`
    )
    .join("");

  $("#addPoint").disabled = state.routePoints.length >= 12;
}

function bindRouteBuilder() {
  const builder = $("#routeBuilder");
  if (!builder) return;

  if (!state.routePoints.length) {
    state.routePoints = state.home.places.slice(0, 3).map((place) => place.id);
  }
  renderRouteBuilder();

  builder.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-index]");
    if (!select) return;
    state.routePoints[Number(select.dataset.index)] = Number(select.value);
  });

  builder.addEventListener("click", (event) => {
    const move = event.target.closest("button[data-move]");
    const remove = event.target.closest("button[data-remove]");

    if (move) {
      const index = Number(move.dataset.index);
      const target = move.dataset.move === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= state.routePoints.length) return;
      [state.routePoints[index], state.routePoints[target]] = [state.routePoints[target], state.routePoints[index]];
      renderRouteBuilder();
    }

    if (remove) {
      if (state.routePoints.length <= 2) return;
      state.routePoints.splice(Number(remove.dataset.remove), 1);
      renderRouteBuilder();
    }
  });

  $("#addPoint").addEventListener("click", () => {
    if (state.routePoints.length >= 12) return;
    const unused = state.home.places.find((place) => !state.routePoints.includes(place.id));
    state.routePoints.push((unused || state.home.places[0]).id);
    renderRouteBuilder();
  });

  $$(".preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const preset = PRESET_ROUTES[Number(chip.dataset.preset)];
      const ids = preset.places.map((name) => placeByName(name)?.id).filter(Boolean);
      if (ids.length < 2) return;
      state.routePoints = ids;
      $("#routeMode").value = preset.modeId;
      renderRouteBuilder();
      toast(`已套用「${preset.name}」，可再自行增減點位。`);
    });
  });

  $("#planRoute").addEventListener("click", async () => {
    const button = $("#planRoute");
    button.disabled = true;
    button.textContent = "規劃中…";

    try {
      const result = await api("/routes/plan", {
        method: "POST",
        body: {
          placeIds: state.routePoints,
          transportModeId: $("#routeMode").value,
          save: false
        }
      });

      $("#routeResult").innerHTML = `
        ${carbonResultCard(result)}
        ${
          result.canSave
            ? '<button class="btn btn-ghost btn-sm" type="button" id="saveRoute">＋ 記錄到海龜養成計畫</button>'
            : '<p class="notice">登入後就能把這條路線的減碳成果存進海龜養成計畫。</p>'
        }
      `;
      const map = $("#routeMap");
      map.hidden = false;
      await paintRouteMap("routeMap", result);

      const saveButton = $("#saveRoute");
      if (saveButton) {
        saveButton.addEventListener("click", async () => {
          saveButton.disabled = true;
          try {
            const saved = await api("/routes/plan", {
              method: "POST",
              body: { placeIds: state.routePoints, transportModeId: $("#routeMode").value, save: true }
            });
            state.turtle = saved.turtle;
            renderAccount();
            saveButton.textContent = "✓ 已記錄";
            toast(`已記錄，海龜生命值 ${saved.turtle.life} / ${saved.turtle.maxLife}`, "success");
          } catch (error) {
            saveButton.disabled = false;
            toast(error.message, "error");
          }
        });
      }
    } catch (error) {
      $("#routeResult").innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    } finally {
      button.disabled = false;
      button.textContent = "規劃路線";
    }
  });
}

async function bindActionsPage() {
  $$(".tab[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.actionsTab = tab.dataset.tab;
      render();
    });
  });

  if (state.actionsTab === "guide") {
    $$("button[data-action-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const result = await api("/turtle/actions", {
            method: "POST",
            body: { actionId: Number(button.dataset.actionId) }
          });
          state.turtle = result.turtle;
          renderAccount();
          button.textContent = "✓ 今日已完成";
          toast(`${result.message} 生命值 ${result.turtle.life} / ${result.turtle.maxLife}`, "success");
        } catch (error) {
          button.disabled = false;
          toast(error.message, "error");
        }
      });
    });
    return;
  }

  const shops = state.home.shops.filter((shop) => shop.category === state.actionsTab);
  const container = $("#shopMap");
  if (container && shops.length) {
    await drawMap(container, state.config, {
      markers: shops.map((shop) => ({ lat: shop.lat, lng: shop.lng, name: shop.name, description: shop.address }))
    });
  }
}

async function bindTurtlePage() {
  const panel = $("#turtlePanel");
  if (!panel) return;
  try {
    const data = await api("/turtle");
    state.turtle = data.turtle;
    panel.innerHTML = turtleDashboard(data);
    renderAccount();
  } catch (error) {
    panel.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
  }
}

function bindLoginPage() {
  const form = $("#authForm");
  if (!form) return;
  let mode = "login";

  $$("[data-auth-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      mode = tab.dataset.authTab;
      $$("[data-auth-tab]").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      $("#nameField").hidden = mode === "login";
      $("#nameField").querySelector("input").required = mode === "register";
      $("#authSubmit").textContent = mode === "login" ? "登入" : "建立帳號";
      form.querySelector("input[name=password]").autocomplete =
        mode === "login" ? "current-password" : "new-password";
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("#authError");
    const button = $("#authSubmit");
    error.hidden = true;
    button.disabled = true;

    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api(`/auth/${mode}`, { method: "POST", body: data });
      state.user = result.user;
      state.turtle = result.turtle;
      renderAccount();
      toast(`歡迎，${result.user.displayName}！`, "success");
      window.location.hash = "#/turtle";
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- 導覽與路由

function renderAccount() {
  const container = $("#navAccount");
  if (state.user) {
    container.innerHTML = `
      <a class="nav-user" href="#/turtle">
        <span aria-hidden="true">🐢</span>
        <span>${esc(state.user.displayName)}</span>
        ${state.turtle ? `<small>${state.turtle.life}/${state.turtle.maxLife}</small>` : ""}
      </a>
      <button class="btn btn-ghost btn-sm" type="button" id="logoutBtn">登出</button>
    `;
    $("#logoutBtn").addEventListener("click", async () => {
      await api("/auth/logout", { method: "POST" }).catch(() => {});
      state.user = null;
      state.turtle = null;
      renderAccount();
      toast("已登出。");
      render();
    });
  } else {
    container.innerHTML = '<a class="btn btn-primary btn-sm" href="#/login">登入 / 註冊</a>';
  }
}

const ROUTES = {
  "/": homePage,
  "/about": aboutPage,
  "/travel": travelPage,
  "/actions": actionsPage,
  "/turtle": turtlePage,
  "/news": newsPage,
  "/team": teamPage,
  "/login": loginPage
};

function currentRoute() {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  return ROUTES[hash] ? hash : "/";
}

async function render() {
  const route = currentRoute();
  const view = $("#view");
  view.innerHTML = ROUTES[route]();

  $$(".primary-nav a[data-route]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.route === route);
  });
  document.body.classList.remove("nav-open");
  $("#navToggle").setAttribute("aria-expanded", "false");

  if (route === "/travel") {
    bindCarbonForm();
    bindRouteBuilder();
  }
  if (route === "/actions") await bindActionsPage();
  if (route === "/turtle") await bindTurtlePage();
  if (route === "/login") bindLoginPage();
  if (route === "/about") {
    await drawMap($("#aboutMap"), state.config, {
      markers: state.home.places.map((place) => ({
        lat: place.lat,
        lng: place.lng,
        name: `${place.emoji} ${place.name}`,
        description: place.description
      }))
    });
  }
}

function bindChrome() {
  const toggle = $("#navToggle");
  toggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "關閉選單" : "開啟選單");
  });

  window.addEventListener("hashchange", () => {
    render();
    $("#view").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

async function boot() {
  try {
    const [config, home, me] = await Promise.all([
      api("/config"),
      api("/home"),
      api("/auth/me").catch(() => ({ user: null }))
    ]);
    state.config = config;
    state.home = home;
    state.user = me.user;
    state.turtle = me.turtle || null;

    bindChrome();
    renderAccount();
    await render();
  } catch (error) {
    $("#view").innerHTML = `
      <section class="panel">
        <h1>系統載入失敗</h1>
        <p class="form-error">${esc(error.message)}</p>
        <p>請確認後端服務是否啟動（預設 http://localhost:4000）。</p>
      </section>`;
  }
}

boot();
