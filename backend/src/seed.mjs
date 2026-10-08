import { batch, get, migrate } from "./db.mjs";

// 座標取自 OpenStreetMap（Nominatim 查詢），除了下方註記「概略」的兩處之外，
// 都是官方或社群標定的實際位置。
const PLACES = [
  { name: "白沙尾觀光港（碼頭）", emoji: "⛴️", category: "port", description: "東琉線渡船碼頭，多數旅客上島的第一站，也是低碳行程的起點。", lat: 22.35251, lng: 120.38448, distance_order: 0 },
  { name: "小琉球新天地免稅商店", emoji: "🛍️", category: "shopping", description: "澎坊免稅商店，就在白沙尾碼頭旁的客運大樓，步行即達。", lat: 22.35226, lng: 120.38457, distance_order: 1 },
  { name: "三民老街", emoji: "🏘️", category: "culture", description: "港邊最熱鬧的街區，減塑店家與在地小吃最密集。", lat: 22.35213, lng: 120.38239, distance_order: 2 },
  { name: "花瓶岩", emoji: "🪨", category: "landmark", description: "小琉球代表地標，從碼頭步行即可抵達的珊瑚礁岩。", lat: 22.35568, lng: 120.38073, distance_order: 3 },
  { name: "美人沙灘", emoji: "🏖️", category: "beach", description: "北岸細沙海灘，適合傍晚散步。", lat: 22.35271, lng: 120.37133, distance_order: 4 },
  { name: "美人洞", emoji: "🌊", category: "trail", description: "海蝕地形與步道群，環境教育導覽熱點。", lat: 22.35334, lng: 120.37257, distance_order: 5 },
  { name: "望海亭", emoji: "👀", category: "viewpoint", description: "美人洞園區制高點，可俯瞰北岸海域。", lat: 22.35318, lng: 120.37320, distance_order: 6 },
  { name: "肚仔坪潮間帶", emoji: "🐚", category: "intertidal", description: "保育示範區，需付觀光保育費並由合格導覽人員帶領。", lat: 22.34883, lng: 120.36381, distance_order: 7 },
  { name: "杉福潮間帶", emoji: "🐢", category: "intertidal", description: "保育示範區，冬季休養期禁止進入。", lat: 22.34332, lng: 120.36203, distance_order: 8 },
  { name: "杉福生態廊道", emoji: "🌿", category: "trail", description: "由軍事坑道改建的濱海步道。", lat: 22.34311, lng: 120.36258, distance_order: 9 },
  { name: "蛤板灣（威尼斯沙灘）", emoji: "🏝️", category: "beach", description: "貝殼砂海灣，島上知名的看夕陽地點。", lat: 22.33428, lng: 120.35996, distance_order: 10 },
  { name: "山豬溝", emoji: "🌿", category: "forest", description: "珊瑚礁裂谷與原生林步道，島上重要的生態教室。", lat: 22.33777, lng: 120.36197, distance_order: 11 },
  { name: "烏鬼洞", emoji: "🪨", category: "trail", description: "結合歷史故事與珊瑚礁地形的園區。", lat: 22.33019, lng: 120.35648, distance_order: 12 },
  { name: "落日亭", emoji: "🌅", category: "viewpoint", description: "西南岸最佳日落觀景點。", lat: 22.32481, lng: 120.35341, distance_order: 13 },
  { name: "觀音石", emoji: "🪨", category: "landmark", description: "南端酷似觀音側影的礁岩地景。", lat: 22.32284, lng: 120.36167, distance_order: 14 },
  { name: "白燈塔（琉球嶼燈塔）", emoji: "🗼", category: "landmark", description: "島上制高處的百年燈塔，適合自行車途經。", lat: 22.32890, lng: 120.36642, distance_order: 15 },
  { name: "紅番石", emoji: "🪨", category: "landmark", description: "東南岸厚石裙礁一帶的礁岩地景。（座標為概略值，待實地校正）", lat: 22.32690, lng: 120.36900, distance_order: 16 },
  { name: "大福漁港（大福碼頭）", emoji: "⚓", category: "port", description: "鹽琉線公營交通船停靠的琉球新港，免稅商品也可在此提領。", lat: 22.33420, lng: 120.37461, distance_order: 17 },
  { name: "碧雲寺", emoji: "🏮", category: "culture", description: "島上信仰中心，鄰近旅遊資訊站。", lat: 22.33806, lng: 120.36982, distance_order: 18 },
  { name: "百年老榕樹", emoji: "🌳", category: "landmark", description: "在地信仰與生活記憶交會的老樹。（座標為概略值，待實地校正）", lat: 22.34350, lng: 120.37650, distance_order: 19 },
  { name: "旭日亭", emoji: "🌅", category: "viewpoint", description: "東岸日出觀景亭，清晨步行剛剛好。", lat: 22.34012, lng: 120.38187, distance_order: 20 },
  { name: "龍蝦洞", emoji: "🦞", category: "landmark", description: "東岸海蝕溝地形，浪大時請勿靠近。", lat: 22.34545, lng: 120.38726, distance_order: 21 },
  { name: "中澳沙灘", emoji: "🌊", category: "beach", description: "海龜常出沒的沙灘，請保持距離、勿觸摸。", lat: 22.34980, lng: 120.38873, distance_order: 22 }
];

const MODES = [
  { id: "walk", name: "步行", icon: "🚶", google_mode: "walking", kg_co2_per_km: 0, points_per_kg_saved: 110 },
  { id: "bike", name: "自行車", icon: "🚲", google_mode: "bicycling", kg_co2_per_km: 0.01, points_per_kg_saved: 100 },
  { id: "electric_scooter", name: "電動機車", icon: "⚡", google_mode: "driving", kg_co2_per_km: 0.035, points_per_kg_saved: 85 },
  { id: "scooter", name: "普通機車", icon: "🛵", google_mode: "driving", kg_co2_per_km: 0.075, points_per_kg_saved: 45 }
];

const SHOPS = [
  // 在地小農／在地食品店家（由團隊實地整理，座標以 OpenStreetMap 門牌定位）
  { name: "琉球鄉農會", category: "farm", type: "在地農產", description: "販售在地與屏東小農蔬果、加工品，食物里程短。", address: "屏東縣琉球鄉本福村民生路 3 號", phone: "08-861-2016", hours: "08:00–17:00", lat: 22.35057, lng: 120.37976, tags: "在地農產,短程運輸,責任消費" },
  { name: "QQ妹傳統手工麻花捲", category: "farm", type: "🍪 在地食品", description: "傳統手工製作的麻花捲，可自備容器裝盛減少包裝。", address: "屏東縣琉球鄉漁福村三民路 112 號", phone: "", hours: "09:00–21:00", lat: 22.34993, lng: 120.38660, tags: "在地食品,手工製作,自備容器" },
  { name: "小琉球有鱻鬼頭刀魚乾", category: "farm", type: "🐟 漁產加工", description: "以在地漁獲製作的鬼頭刀魚乾，支持島上漁業。", address: "屏東縣琉球鄉漁福村三民路 117-6 號", phone: "", hours: "09:00–20:00", lat: 22.34816, lng: 120.38744, tags: "在地漁產,漁產加工,友善海洋" },
  { name: "蜜仔蕃薯糖", category: "farm", type: "🍠 地方特產", description: "白沙觀光港內的地方特產店，也是琉行杯的合作店家。", address: "屏東縣琉球鄉白沙觀光港 4 號商店", phone: "", hours: "08:00–18:00", lat: 22.35230, lng: 120.38430, tags: "地方特產,在地食品,琉行杯合作" },
  { name: "龍興行", category: "farm", type: "🐟 在地海產", description: "在地食品與海產，販售島上與周邊海域的漁產加工品。", address: "屏東縣琉球鄉（詳細地址待補）", phone: "", hours: "", lat: 22.35180, lng: 120.38270, tags: "在地海產,在地食品" },

  { name: "咕咕碗租借站 — 白沙尾遊客中心", category: "bowl", type: "環保餐盒租借", description: "上島第一站即可借用環保餐盒，離島前歸還。", address: "屏東縣琉球鄉白沙尾觀光港旁", phone: "", hours: "08:00–17:00", lat: 22.35245, lng: 120.38420, tags: "環保餐盒,甲地借乙地還,免押金" },
  { name: "咕咕碗租借站 — 三民老街", category: "bowl", type: "環保餐盒租借", description: "老街小吃最密集的租借點，買小吃前先借碗。", address: "屏東縣琉球鄉三民路", phone: "", hours: "10:00–21:00", lat: 22.34999, lng: 120.38635, tags: "環保餐盒,減少一次性餐具" },
  { name: "咕咕碗租借站 — 中山路商圈", category: "bowl", type: "環保餐盒租借", description: "鄰近農會與便利商店，適合外帶正餐。", address: "屏東縣琉球鄉中山路", phone: "", hours: "09:00–20:00", lat: 22.35190, lng: 120.38210, tags: "環保餐盒,外帶,減塑" },

  { name: "琉行杯租借點 — 白沙尾港前", category: "cup", type: "環保杯租借", description: "全島超過 80 處租借點之一，可甲地借乙地還。", address: "屏東縣琉球鄉白沙尾觀光港", phone: "", hours: "08:00–18:00", lat: 22.35258, lng: 120.38452, tags: "琉行杯,共享,甲借乙還" },
  { name: "琉行杯租借點 — 三民路飲料店", category: "cup", type: "環保杯租借", description: "配合店家提供自備杯折扣，減少一次性飲料杯。", address: "屏東縣琉球鄉三民路", phone: "", hours: "10:00–21:00", lat: 22.34960, lng: 120.38690, tags: "琉行杯,自備杯折扣" },
  { name: "琉行杯租借點 — 中山路咖啡館", category: "cup", type: "環保杯租借", description: "借杯買飲料享折扣的合作店家。", address: "屏東縣琉球鄉中山路", phone: "", hours: "09:00–18:00", lat: 22.35225, lng: 120.38255, tags: "琉行杯,咖啡,減塑" },
  { name: "琉行杯租借點 — 美人洞商店", category: "cup", type: "環保杯租借", description: "景點旁補水與借杯站，減少寶特瓶。", address: "屏東縣琉球鄉美人洞園區", phone: "", hours: "08:00–17:30", lat: 22.35330, lng: 120.37270, tags: "琉行杯,飲水補給" },

  { name: "電動機車租借 — 白沙尾港站", category: "ev", type: "綠色運具", description: "下船即可租借電動機車，島上設有多處充電站。", address: "屏東縣琉球鄉白沙尾觀光港", phone: "", hours: "07:30–18:30", lat: 22.35240, lng: 120.38390, tags: "電動機車,APP 租借,低碳運具" },
  { name: "電動機車充電站 — 美人洞", category: "ev", type: "充電站", description: "景點旁快充站，約 10 分鐘可補充里程。", address: "屏東縣琉球鄉美人洞園區", phone: "", hours: "24 小時", lat: 22.35340, lng: 120.37230, tags: "快充,電動機車" },
  { name: "電動機車充電站 — 烏鬼洞", category: "ev", type: "充電站", description: "南環路線的補電點，適合環島中途停靠。", address: "屏東縣琉球鄉烏鬼洞園區", phone: "", hours: "24 小時", lat: 22.33030, lng: 120.35670, tags: "快充,環島" },
  { name: "電動自行車租借 — 大福漁港", category: "ev", type: "綠色運具", description: "鹽琉線旅客的租借點，提供電輔自行車。", address: "屏東縣琉球鄉大福漁港", phone: "", hours: "08:00–19:00", lat: 22.33430, lng: 120.37450, tags: "電輔自行車,短程,低碳運具" }
];

const ACTIONS = [
  { title: "自備環保杯或租借琉行杯", description: "以琉行杯取代一次性飲料杯，全島超過 80 處可甲地借乙地還。", points: 30, co2_saved_kg: 0.05 },
  { title: "租借咕咕碗吃小吃", description: "用環保餐盒取代免洗餐具，離島前歸還即可。", points: 35, co2_saved_kg: 0.08 },
  { title: "自備盥洗用品與毛巾", description: "減少旅宿一次性備品消耗。", points: 25, co2_saved_kg: 0.06 },
  { title: "參加淨灘或淨海活動", description: "以行動移除海漂垃圾，同時認識海洋廢棄物來源。", points: 80, co2_saved_kg: 0.2 },
  { title: "支持在地小農與友善店家", description: "縮短食物里程，降低運輸與包裝碳排。", points: 40, co2_saved_kg: 0.12 },
  { title: "潮間帶不觸摸、不採集、不餵食", description: "遵守保育示範區規範，走在規劃路線上。", points: 20, co2_saved_kg: 0 },
  { title: "選擇電動機車或自行車環島", description: "以低碳運具取代燃油機車。", points: 50, co2_saved_kg: 0.4 }
];


// 皆為 2026 年公開報導，主題聚焦「推廣觀光 × 促進環保意識」，連結至原始出處。
const ARTICLES = [
  {
    title: "小琉球發布首支永續旅遊宣導影片 攜手推動無碳島生活 成低碳旅遊新典範",
    category: "永續旅遊",
    summary: "琉球鄉生態觀光產業發展協會推出《小琉球無碳島生活》宣導影片，以低碳交通、生態教育、循環經濟、海洋保育與在地產業五大主軸，呈現島上推動永續觀光的成果。",
    source: "台灣新聞雲",
    url: "https://886.news/archives/346637",
    published_at: "2026-07-17"
  },
  {
    title: "小琉球愛龜淨灘接力將開跑 鵬管處邀遊客關注官網資訊",
    category: "淨灘行動",
    summary: "暑假海龜產卵季來臨，大鵬灣國家風景區管理處將舉辦年度愛龜淨灘接力賽，邀請遊客把淨灘納入行程，一起守護海龜上岸的沙灘。",
    source: "屏東新聞",
    url: "https://www.94ipt.tw/2026/06/25/26877",
    published_at: "2026-06-25"
  },
  {
    title: "小琉球志工隊淨海17年不間斷 今達「下水500次」里程碑",
    category: "海洋守護",
    summary: "5 位居民因目睹海龜纏網而發起的海洋志工隊，17 年來成長到近百人並完成第 500 次淨海。近年珊瑚礁魚類與海龜明顯增加，島邊淺海的廢棄漁具已大致清除。",
    source: "聯合新聞網",
    url: "https://udn.com/news/story/7327/9474959",
    published_at: "2026-04-30"
  },
  {
    title: "站在岸邊就能看海龜！小琉球綠蠵龜密度冠居全球 成世界級保育天堂",
    category: "海龜保育",
    summary: "台灣唯一的珊瑚礁島擁有全球最高的綠蠵龜密度，站在岸邊就有機會看到海龜。在地居民與政府共同推廣「不觸摸、不追逐、不包圍、不干擾、不擦防曬」五原則。",
    source: "倡議家（聯合報系）",
    url: "https://ubrand.udn.com/ubrand/story/123659/9416131",
    published_at: "2026-04-06"
  },
  {
    title: "影／空拍看台灣 相遇海龜島 小琉球生態豐富成為海龜悠遊天堂",
    category: "島嶼風貌",
    summary: "以空拍記錄小琉球的珊瑚礁地景與海龜棲地，島上長年可見數百隻綠蠵龜，歷史紀錄最高曾達 805 隻，是名副其實的海龜島。",
    source: "聯合新聞網",
    url: "https://udn.com/news/story/7327/9411431",
    published_at: "2026-03-30"
  },
  {
    title: "綠蠵龜冬季小琉球產卵 海保署：生態系功能完整",
    category: "海龜保育",
    summary: "海保署記錄到綠蠵龜在蛤板灣成功產卵並孵化，代表沙質條件良好、人為干擾低，生態系功能完整。同時提醒遊客夜間勿在沙灘使用手電筒或靠近巢區。",
    source: "聯合新聞網（中央社）",
    url: "https://udn.com/news/story/7470/9383284",
    published_at: "2026-03-16"
  },
  {
    title: "菸蒂不入海！小琉球推廣責任旅遊 撿滿1瓶菸蒂即可換環保小禮",
    category: "責任旅遊",
    summary: "把淨灘變成旅遊闖關：撿滿一瓶菸蒂可換海龜保育明信片，集滿島上五個環保行動點的印章再換環保布織品，讓環保行動融進旅程節奏。",
    source: "倡議家（聯合報系）",
    url: "https://ubrand.udn.com/ubrand/story/123661/9291023",
    published_at: "2026-02-01"
  }
];

/** 只在資料表為空時寫入；所有 INSERT 併成一次 batch，Turso 才不用來回幾十趟。 */
async function seedTable(table, rows, insertSql) {
  const existing = await get(`SELECT COUNT(*) AS count FROM ${table}`);
  if (existing.count > 0) return;
  await batch(rows.map((row) => ({ sql: insertSql, params: row })));
}

export async function seed() {
  await migrate();

  await seedTable(
    "places",
    PLACES,
    `INSERT INTO places (name, emoji, category, description, lat, lng, distance_order)
     VALUES (:name, :emoji, :category, :description, :lat, :lng, :distance_order)`
  );

  await seedTable(
    "transport_modes",
    MODES,
    `INSERT INTO transport_modes (id, name, icon, google_mode, kg_co2_per_km, points_per_kg_saved)
     VALUES (:id, :name, :icon, :google_mode, :kg_co2_per_km, :points_per_kg_saved)`
  );

  await seedTable(
    "sustainable_shops",
    SHOPS,
    `INSERT INTO sustainable_shops (name, category, type, description, address, phone, hours, lat, lng, tags)
     VALUES (:name, :category, :type, :description, :address, :phone, :hours, :lat, :lng, :tags)`
  );

  await seedTable(
    "plastic_actions",
    ACTIONS,
    `INSERT INTO plastic_actions (title, description, points, co2_saved_kg)
     VALUES (:title, :description, :points, :co2_saved_kg)`
  );

  await seedTable(
    "articles",
    ARTICLES,
    `INSERT INTO articles (title, category, summary, source, url, published_at)
     VALUES (:title, :category, :summary, :source, :url, :published_at)`
  );
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("seed.mjs")) {
  await import("./env.mjs");
  await seed();
  console.log("Seed completed.");
}
