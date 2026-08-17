const API_BASE = "http://localhost:4000/api";

const state = {
  turtleLife: 0,
  home: null
};

const $ = (selector) => document.querySelector(selector);

function option(place) {
  return `<option value="${place.id}">${place.name}</option>`;
}

function renderHome(data) {
  state.home = data;

  $("#startPlace").innerHTML = data.places.map(option).join("");
  $("#endPlace").innerHTML = data.places.map(option).join("");
  $("#endPlace").selectedIndex = Math.min(1, data.places.length - 1);

  $("#transportModes").innerHTML = data.modes
    .map(
      (mode, index) => `
        <label class="mode-choice">
          <input type="radio" name="transportModeId" value="${mode.id}" ${index === 0 ? "checked" : ""} />
          ${mode.name}
        </label>
      `
    )
    .join("");

  $("#placeGrid").innerHTML = data.places
    .map(
      (place) => `
        <article class="place-card">
          <strong>${place.name}</strong>
          <p>${place.description}</p>
          <span class="pill">${place.category}</span>
        </article>
      `
    )
    .join("");

  $("#actionList").innerHTML = data.actions
    .map(
      (action) => `
        <article class="list-item">
          <strong>${action.title}</strong>
          <p>${action.description}</p>
          <span class="pill">+${action.points} 點 · 減碳 ${action.co2_saved_kg} kg</span>
        </article>
      `
    )
    .join("");

  $("#shopList").innerHTML = data.shops
    .map(
      (shop) => `
        <article class="list-item">
          <strong>${shop.name}</strong>
          <p>${shop.description}</p>
          <span class="pill">${shop.tags}</span>
        </article>
      `
    )
    .join("");

  $("#articleList").innerHTML = data.articles
    .map(
      (article) => `
        <article class="article-card">
          <strong>${article.title}</strong>
          <p>${article.summary}</p>
          <span class="pill">${article.category} · ${article.published_at}</span>
        </article>
      `
    )
    .join("");
}

function updateTurtle(life) {
  state.turtleLife = Math.min(1000, Math.max(0, life));
  $("#turtleLife").textContent = state.turtleLife;
  $("#lifeMeter").style.width = `${state.turtleLife / 10}%`;

  const stage = state.turtleLife >= 601 ? "成龜" : state.turtleLife >= 301 ? "青龜" : state.turtleLife > 0 ? "幼龜" : "蛋";
  $("#turtleStage").textContent = stage;
}

async function calculateCarbon(event) {
  event.preventDefault();

  const payload = {
    startPlaceId: $("#startPlace").value,
    endPlaceId: $("#endPlace").value,
    transportModeId: new FormData(event.currentTarget).get("transportModeId")
  };

  const response = await fetch(`${API_BASE}/carbon/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    $("#carbonResult").textContent = result.error || "計算失敗";
    return;
  }

  updateTurtle(state.turtleLife + result.turtleLife);
  $("#carbonResult").innerHTML = `
    <strong>${result.route.start} → ${result.route.end}</strong><br />
    交通方式：${result.mode.name}，距離約 ${result.route.distanceKm} km<br />
    預估排碳：${result.estimatedKg} kg CO2e，減碳：${result.savedKg} kg<br />
    可獲得 <strong>+${result.points}</strong> 點。${result.message}
  `;
}

async function boot() {
  $("#carbonForm").addEventListener("submit", calculateCarbon);
  const response = await fetch(`${API_BASE}/home`);
  renderHome(await response.json());
}

boot().catch((error) => {
  $("#carbonResult").textContent = `系統載入失敗：${error.message}`;
});
