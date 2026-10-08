# 頂琉計畫：琉意健康 綠行琉客

依照提案簡報建立的前後端分離網站系統。前台面向大眾瀏覽，後端提供 REST API，資料存放在 SQLite。

## 架構

- `backend/`: Node.js 原生 HTTP API + SQLite（`node:sqlite`，無 npm 相依套件）
- `frontend/`: 靜態前端（原生 ES module 的 hash 路由單頁應用）
- `backend/data/app.db`: 開發用 SQLite 資料庫，啟動時若不存在會自動建立並 seed

## 啟動

只跑後端就能同時提供 API 與網頁：

```bash
npm run dev
```

開啟 http://localhost:4000 即可。若要前後端分離開發，另開一個終端機跑 `npm run dev:frontend`（http://localhost:5173，會自動連到 4000 的 API）。

## 環境變數

把 `.env.example` 複製成 `.env`，填好之後重新啟動 server 即可（`.env` 已被 gitignore 排除）。部署平台（如 Railway）上直接設定的環境變數優先於 `.env`。

**全部留空也能正常運作**，不需要任何金鑰或信用卡。

| 變數 | 用途 | 未設定時 |
| --- | --- | --- |
| `PORT` | 後端埠號 | 4000 |
| `ORS_API_KEY` | OpenRouteService 金鑰（免費註冊，不需信用卡） | 使用 OSRM 公開伺服器 |
| `GOOGLE_MAPS_API_KEY` | Google Routes / Directions 金鑰（需計費帳戶） | 同上 |
| `GOOGLE_MAPS_BROWSER_KEY` | 前端 Google Maps JavaScript API 金鑰 | 使用 Leaflet + OpenStreetMap |
| `ROUTING_PROVIDER` | 強制指定路線來源：`google` / `ors` / `osrm` / `estimate` | 自動選擇 |
| `OSRM_BASE_URL` | 自架 OSRM 伺服器位址 | 官方公開伺服器 |
| `TURSO_DATABASE_URL` | Turso 雲端資料庫位址（免費、免信用卡） | 用本機 SQLite 檔 |
| `TURSO_AUTH_TOKEN` | Turso 存取權杖 | 同上 |
| `DB_PATH` | 本機 SQLite 檔案位置 | `backend/data/app.db` |

## 功能

- **會員系統**：註冊 / 登入 / 登出，scrypt 雜湊密碼 + HttpOnly Cookie session（30 天）
- **碳足跡計算**：23 個景點（含兩處碼頭與免稅商店）任選起訖與交通方式，依實際道路距離估算排碳、減碳與點數
- **低碳路線規劃**：可自訂 2–12 個點位、調整順序、套用預設路線，並取得 Google Maps 導航連結
- **地圖**：所有點位相關頁面（景點、路線、店家）都有地圖；有金鑰用 Google Maps，沒有則自動退回 OpenStreetMap
- **海龜養成計畫**：需登入。減碳點數轉換為海龜生命值（0–100），分為龜蛋／破殼／幼龜／青龜／成龜，保存行程與打卡紀錄
- **永續行動**：在地小農店家、咕咕碗租借點、琉行杯租借點、電動車出租站四個分頁，各自附地圖與導航
- **減塑行動指南**：每項行動每天可打卡一次，直接累積生命值
- **最新消息**：7 篇整理自公開網路來源的報導，均標明出處並連結原文

## 資料庫

程式支援兩種資料庫，啟動時會印出正在用哪一種：

- **本機 SQLite 檔**（預設）— 開發用，不需要任何設定
- **Turso**（設了 `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` 時）— SQLite 相容的雲端資料庫，透過內建 `fetch` 呼叫其 HTTP API，不需要任何 npm 套件

兩者的 SQL 完全相同，差別只在 `backend/src/sql.mjs` 裡的驅動。

### 正式環境一定要用 Turso

Render 免費方案的檔案系統是暫時的。依照 [Render 官方文件](https://render.com/docs/free)，檔案「每次服務重新部署、重新啟動或休眠時都會遺失」，而免費服務閒置 15 分鐘就會休眠 —— 也就是說，**用本機 SQLite 檔部署的話，使用者帳號與海龜養成進度每 15 分鐘就會全部消失**。

### 建立 Turso 資料庫

1. 到 [turso.tech](https://turso.tech) 用 GitHub 登入（免費方案不需要信用卡）。
2. 建立一個資料庫，區域選離台灣最近的（例如 Singapore 或 Tokyo）。
3. 在資料庫頁面取得兩個值：
   - **Database URL**（長得像 `libsql://xxx-yyy.turso.io`）
   - **Auth Token**（按 Create Token 產生）
4. 本機開發：填進 `.env`。正式環境：填到 Render 後台的 **Environment**，存檔後它會自動重新部署。

啟動訊息出現「資料庫：Turso（…）— 資料永久保存」就代表接上了。

免費方案額度為 5GB 儲存、每月 5 億次讀取與 1000 萬次寫入，這個專案的用量遠低於上限。

## 路線服務

距離計算會依序嘗試以下來源，第一個成功的就採用，全部失敗才退回離線推估。啟動時會印出實際使用的來源。

| 順位 | 來源 | 需要金鑰？ | 說明 |
| --- | --- | --- | --- |
| 1 | Google Routes API | 需計費帳戶 | 設 `GOOGLE_MAPS_API_KEY` 後啟用 |
| 2 | Google Directions API | 同上 | 給只有舊版 API 的專案 |
| 3 | OpenRouteService | 免費金鑰，免信用卡 | 設 `ORS_API_KEY`，真的區分步行／單車／汽車 |
| 4 | **OSRM 公開伺服器** | **不需要** | **預設值**，回傳真實道路距離 |
| 5 | Haversine × 1.3 | 不需要 | 完全離線的最後備援 |

### 預設（不用設定任何東西）

直接 `npm run dev` 就會使用 OSRM 公開伺服器取得真實道路距離，地圖使用 OpenStreetMap。這是一個沒有 SLA 的公開測試伺服器，展示與開發足夠，正式營運建議升級到下面兩種之一。

OSRM 公開伺服器只跑汽車路網，所以程式取用它的**道路距離**，**時間**則依交通方式自行換算（小琉球步行與單車走的是同一批道路，誤差可接受）。

### 升級選項 A：OpenRouteService（推薦，免信用卡）

到 [openrouteservice.org](https://openrouteservice.org/dev/#/signup) 註冊拿金鑰，填進 `.env` 的 `ORS_API_KEY`。每日 2000 次免費，且會依步行／單車／汽車使用不同路網。

### 升級選項 B：Google Maps Platform

需要啟用計費帳戶（在台灣可能被要求預付）。步驟：

1. [Google Cloud Console](https://console.cloud.google.com/) 建立專案並啟用計費。
2. 啟用 **Routes API**（後端）與 **Maps JavaScript API**（前端地圖）。
3. 建立**兩把**金鑰：伺服器金鑰以「IP 位址」限制、只勾 Routes API；瀏覽器金鑰以「HTTP 參照網址」限制網域、只勾 Maps JavaScript API。
4. 填進 `.env`，重新啟動 server。
5. 建議另外設定 API 每日配額上限與預算警示，避免金鑰外洩造成意外費用。

### 導航

導航按鈕使用 Google Maps 的通用連結（`google.com/maps/dir/?api=1`），**任何情況下都不需要金鑰、不會計費**。

## 資料來源說明

- **景點座標**取自 OpenStreetMap（Nominatim 查詢），共 23 個點位。僅「紅番石」與「百年老榕樹」在 OSM 查無資料，目前為概略值，已在該景點說明中標註
- **在地店家**（琉球鄉農會、QQ妹傳統手工麻花捲、小琉球有鱻鬼頭刀魚乾、蜜仔蕃薯糖、龍興行）為團隊實地整理，座標以門牌定位；龍興行的詳細地址待補
- **咕咕碗／琉行杯／電動車**據點目前仍為示範資料，需與在地單位確認後更新
- **碳排係數**為規劃階段的參考值，尚未採用單一官方來源

## 待確認的產品問題

- 碳足跡係數要採用哪個正式來源（環境部？IPCC？）
- 店家資料由誰維護、是否需要後台審核流程
- 是否需要部署到正式主機並改用 PostgreSQL
- 減塑行動打卡是否需要憑證（例如租借紀錄），避免自由灌點數
