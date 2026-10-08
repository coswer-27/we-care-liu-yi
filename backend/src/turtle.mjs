import { all, get, run } from "./db.mjs";

/** 生命值上限；提案簡報的示意圖使用 0–100 的刻度。 */
export const MAX_LIFE = 100;
/** 每 5 點減碳點數換 1 點生命值。 */
export const POINTS_PER_LIFE = 5;

const STAGES = [
  { min: 80, name: "成龜", emoji: "🐢", blurb: "牠已經能自在悠游，帶著你的減碳成果守護這片海。" },
  { min: 50, name: "青龜", emoji: "🐢", blurb: "殼色轉深，開始學會避開廢棄漁網與塑膠袋。" },
  { min: 20, name: "幼龜", emoji: "🐣", blurb: "剛爬向大海的小海龜，需要更多低碳行動陪牠長大。" },
  { min: 1, name: "破殼", emoji: "🥚", blurb: "蛋殼裂了一道縫，再一點減碳行動就能孵化。" },
  { min: 0, name: "龜蛋", emoji: "🥚", blurb: "沙灘上的一顆龜蛋，正等待你的第一趟低碳旅程。" }
];

export function stageFor(life) {
  return STAGES.find((stage) => life >= stage.min) || STAGES[STAGES.length - 1];
}

async function ensureRow(userId) {
  const existing = await get("SELECT * FROM turtle_progress WHERE user_id = :id", { id: userId });
  if (existing) return existing;

  await run(
    `INSERT INTO turtle_progress (user_id, total_points, total_saved_kg, trip_count, action_count, updated_at)
     VALUES (:id, 0, 0, 0, 0, :now)`,
    { id: userId, now: new Date().toISOString() }
  );
  return await get("SELECT * FROM turtle_progress WHERE user_id = :id", { id: userId });
}

export async function progressFor(userId) {
  const row = await ensureRow(userId);
  const life = Math.min(MAX_LIFE, Math.floor(row.total_points / POINTS_PER_LIFE));
  const stage = stageFor(life);
  const nextStage = [...STAGES].reverse().find((s) => s.min > life) || null;

  return {
    life,
    maxLife: MAX_LIFE,
    stage: stage.name,
    stageEmoji: stage.emoji,
    stageBlurb: stage.blurb,
    nextStage: nextStage ? { name: nextStage.name, life: nextStage.min } : null,
    pointsToNextLife: POINTS_PER_LIFE - (row.total_points % POINTS_PER_LIFE),
    totalPoints: row.total_points,
    totalSavedKg: Number(row.total_saved_kg.toFixed(2)),
    tripCount: row.trip_count,
    actionCount: row.action_count,
    updatedAt: row.updated_at
  };
}

export async function addTrip(userId, { summary, modeId, distanceKm, estimatedKg, savedKg, points }) {
  await ensureRow(userId);
  const now = new Date().toISOString();

  await run(
    `INSERT INTO trip_logs (user_id, summary, mode_id, distance_km, estimated_kg, saved_kg, points, created_at)
     VALUES (:user_id, :summary, :mode_id, :distance_km, :estimated_kg, :saved_kg, :points, :now)`,
    {
      user_id: userId,
      summary,
      mode_id: modeId,
      distance_km: distanceKm,
      estimated_kg: estimatedKg,
      saved_kg: savedKg,
      points,
      now
    }
  );
  await run(
    `UPDATE turtle_progress
        SET total_points = total_points + :points,
            total_saved_kg = total_saved_kg + :saved,
            trip_count = trip_count + 1,
            updated_at = :now
      WHERE user_id = :user_id`,
    { points, saved: savedKg, now, user_id: userId }
  );
  return await progressFor(userId);
}

export async function addAction(userId, action) {
  await ensureRow(userId);
  const now = new Date().toISOString();

  await run(
    `INSERT INTO action_logs (user_id, action_id, title, points, co2_saved_kg, created_at)
     VALUES (:user_id, :action_id, :title, :points, :co2, :now)`,
    { user_id: userId, action_id: action.id, title: action.title, points: action.points, co2: action.co2_saved_kg, now }
  );
  await run(
    `UPDATE turtle_progress
        SET total_points = total_points + :points,
            total_saved_kg = total_saved_kg + :saved,
            action_count = action_count + 1,
            updated_at = :now
      WHERE user_id = :user_id`,
    { points: action.points, saved: action.co2_saved_kg, now, user_id: userId }
  );
  return await progressFor(userId);
}

export async function historyFor(userId, limit = 20) {
  const [trips, actions] = await Promise.all([
    all("SELECT * FROM trip_logs WHERE user_id = :id ORDER BY created_at DESC, id DESC LIMIT :limit", {
      id: userId,
      limit
    }),
    all("SELECT * FROM action_logs WHERE user_id = :id ORDER BY created_at DESC, id DESC LIMIT :limit", {
      id: userId,
      limit
    })
  ]);
  return { trips, actions };
}

/** 今天是否已經完成過同一項減塑行動（避免重複打卡刷點數）。 */
export async function actionDoneToday(userId, actionId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = await get(
    `SELECT COUNT(*) AS count FROM action_logs
      WHERE user_id = :id AND action_id = :action AND substr(created_at, 1, 10) = :today`,
    { id: userId, action: actionId, today }
  );
  return row.count > 0;
}
