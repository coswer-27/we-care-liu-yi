import { all, db, migrate } from "./db.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function seedTable(table, rows, insertSql) {
  const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  if (count > 0) return;
  const insert = db.prepare(insertSql);
  db.exec("BEGIN");
  for (const row of rows) insert.run(row);
  db.exec("COMMIT");
}

export function seed() {
  migrate();

  seedTable(
    "places",
    [
    { name: "白沙尾", category: "beach", description: "適合低碳慢遊與海岸觀察的入口景點。", distance_order: 1 },
    { name: "花瓶岩", category: "landmark", description: "小琉球代表地標，可串連步行與自行車路線。", distance_order: 3 },
    { name: "美人洞", category: "trail", description: "海蝕地形與自然步道，適合環境教育導覽。", distance_order: 5 },
    { name: "烏鬼洞", category: "trail", description: "結合歷史故事與生態觀察的熱門景點。", distance_order: 7 },
    { name: "山豬溝", category: "forest", description: "綠意步道與在地自然教育場域。", distance_order: 9 }
    ],
    `INSERT INTO places (name, category, description, distance_order)
     VALUES (:name, :category, :description, :distance_order)`
  );

  seedTable(
    "transport_modes",
    [
    { id: "walk", name: "步行", icon: "footprints", kg_co2_per_km: 0, points_per_kg_saved: 110 },
    { id: "bike", name: "自行車", icon: "bike", kg_co2_per_km: 0.01, points_per_kg_saved: 100 },
    { id: "electric_scooter", name: "電動車", icon: "zap", kg_co2_per_km: 0.035, points_per_kg_saved: 85 },
    { id: "scooter", name: "普通機車", icon: "bike", kg_co2_per_km: 0.075, points_per_kg_saved: 45 }
    ],
    `INSERT INTO transport_modes (id, name, icon, kg_co2_per_km, points_per_kg_saved)
     VALUES (:id, :name, :icon, :kg_co2_per_km, :points_per_kg_saved)`
  );

  seedTable(
    "sustainable_shops",
    [
    {
      name: "海島補給所",
      type: "refill",
      description: "提供飲水補給與環保餐具租借。",
      address: "琉球鄉民生路 12 號",
      tags: "飲水補給,環保餐具,減塑"
    },
    {
      name: "珊瑚慢食",
      type: "food",
      description: "主打在地食材與低包裝餐點。",
      address: "琉球鄉中山路 88 號",
      tags: "在地食材,低包裝,友善海洋"
    },
    {
      name: "藍潮旅店",
      type: "lodging",
      description: "鼓勵續住不更換備品，提供低碳旅遊資訊。",
      address: "琉球鄉杉板路 21 號",
      tags: "永續住宿,低碳旅遊"
    }
    ],
    `INSERT INTO sustainable_shops (name, type, description, address, tags)
     VALUES (:name, :type, :description, :address, :tags)`
  );

  seedTable(
    "plastic_actions",
    [
    { title: "自備水壺", description: "旅途中使用補水站，減少瓶裝水。", points: 30, co2_saved_kg: 0.2 },
    { title: "使用環保餐具", description: "外食時避免一次性餐具。", points: 35, co2_saved_kg: 0.3 },
    { title: "支持永續店家", description: "選擇有減塑或在地採購行動的店家。", points: 50, co2_saved_kg: 0.5 },
    { title: "參與淨灘", description: "加入社區或旅宿發起的海岸清潔。", points: 120, co2_saved_kg: 1.2 }
    ],
    `INSERT INTO plastic_actions (title, description, points, co2_saved_kg)
     VALUES (:title, :description, :points, :co2_saved_kg)`
  );

  seedTable(
    "articles",
    [
    {
      title: "小琉球海龜保育季開跑",
      category: "news",
      summary: "一起守護海洋生態，認識友善觀察距離。",
      published_at: "2026-08-01"
    },
    {
      title: "低碳旅遊小知識：如何減少旅程碳排",
      category: "education",
      summary: "從交通、飲食到住宿，建立更友善的旅行選擇。",
      published_at: "2026-07-26"
    },
    {
      title: "在地小農市集周末開跑",
      category: "local",
      summary: "支持在地消費，也支持永續小農。",
      published_at: "2026-07-18"
    }
    ],
    `INSERT INTO articles (title, category, summary, published_at)
     VALUES (:title, :category, :summary, :published_at)`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed();
  console.log("Database ready");
  console.table(all("SELECT name FROM places ORDER BY distance_order"));
}
