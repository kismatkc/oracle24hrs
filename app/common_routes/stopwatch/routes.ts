// app/common_routes/stopwatch/routes.ts
import express, { Request, Response } from "express";
import { BullRedis as Redis } from "../../../lib/bullRedis.ts";

import {
  loadDay,
  createDay,
  saveDay,
  appendOpenSegment,
  closeOpenSegment,
  getSegments,
  sumSegments,
  shrinkLastSegment,
  ensureRepeatJob,
  clearRepeatJob,
  clearAllSegments,
  ensureGoalJob,
  clearGoalJob,

  // NEW criterion-aware helpers
  appendOpenCriterionSegment,
  closeOpenCriterionSegment,
  getCriterionSegments,
  shrinkLastCriterionSegment,
  ensureCriterionGoalJob,
  clearCriterionGoalJob,
  overallProgressMs,
  allCriteriaMet,
} from "./queue.ts";

const router = express.Router();

/* ───────────── DayKey normalization (server-local, with reset hour) ───────────── */
const RESET_HOUR = Number(process.env.RESET_HOUR ?? 4);

function serverLocalDayKey(resetHour = RESET_HOUR) {
  const d = new Date();
  if (d.getHours() < resetHour) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYYYYMMDD(s: string) {
  const [Y, M, D] = s.split("-").map(Number);
  return Date.UTC(Y, (M || 1) - 1, D || 1);
}

function normalizeDayKey(input?: string) {
  const today = serverLocalDayKey();
  if (!input) return today;
  try {
    const deltaDays = (parseYYYYMMDD(input) - parseYYYYMMDD(today)) / 86_400_000;
    if (deltaDays === 1) return today; // coerce common +1d UTC bug
  } catch {}
  return input;
}

/* ───────────── Habits storage ───────────── */
const HABITS_SET = (userId: string) => `stopwatch:${userId}:habits`;
const HABIT_HASH = (userId: string, id: string) => `stopwatch:${userId}:habit:${id}`;
const SELECTED_KEY = (userId: string) => `stopwatch:${userId}:habit:selected`;
const TITLE_INDEX = (userId: string) => `stopwatch:${userId}:titleIndex`;

type HabitCriterion = { id: string; title: string; minutes: number };
type Habit = { id: string; title: string; minutes: number; criteria?: HabitCriterion[] };

const makeId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const normTitle = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function listHabits(userId: string): Promise<Habit[]> {
  const ids = await Redis.smembers(HABITS_SET(userId));
  if (!ids?.length) return [];

  const pipeline = ids.map((id) => ["hgetall", HABIT_HASH(userId, id)] as const);
  const rows = await (Redis as any).multi(pipeline).exec();

  return rows
    .map(([, h]: any, i: number) => {
      const item: Habit = {
        id: ids[i],
        title: h?.title ?? "",
        minutes: Number(h?.minutes ?? 0),
      };
      if (h?.criteria) {
        try {
          const arr = JSON.parse(h.criteria);
          if (Array.isArray(arr)) item.criteria = arr;
        } catch {}
      }
      return item;
    })
    .filter((h) => h.title);
}

class DuplicateTitleError extends Error {
  code = "DUPLICATE_TITLE";
}

async function upsertHabit(userId: string, input: Partial<Habit>): Promise<Habit> {
  const id = input.id || makeId();
  const title = (input.title || "").trim();
  const minutes = Math.max(1, Number(input.minutes || 1));
  const newNorm = normTitle(title);

  // find existing mapping for this normalized title
  const mappedId = (await Redis.hget(TITLE_INDEX(userId), newNorm)) as string | null;
  if (mappedId && mappedId !== id) {
    throw new DuplicateTitleError("A habit with that title already exists");
  }

  // normalize criteria (optional)
  let criteria: HabitCriterion[] | undefined = undefined;
  if (Array.isArray(input.criteria)) {
    criteria = input.criteria.map((c) => ({
      id: c.id || makeId(),
      title: (c.title || "").trim(),
      minutes: Math.max(1, Number(c.minutes || 1)),
    }));
  }

  // old title (if updating)
  const prev = await Redis.hgetall(HABIT_HASH(userId, id));
  const prevTitle = prev?.title as string | undefined;
  const prevNorm = prevTitle ? normTitle(prevTitle) : null;

  const toSet: Record<string, string> = { title, minutes: String(minutes) };
  if (criteria) toSet.criteria = JSON.stringify(criteria);

  await Redis.hset(HABIT_HASH(userId, id), toSet);
  await Redis.sadd(HABITS_SET(userId), id);

  // update title index
  if (prevNorm && prevNorm !== newNorm) await Redis.hdel(TITLE_INDEX(userId), prevNorm);
  await Redis.hset(TITLE_INDEX(userId), newNorm, id);

  return { id, title, minutes, criteria };
}

async function deleteHabit(userId: string, id: string) {
  // remove title index mapping
  const h = await Redis.hgetall(HABIT_HASH(userId, id));
  if (h?.title) await Redis.hdel(TITLE_INDEX(userId), normTitle(h.title));

  await Redis.del(HABIT_HASH(userId, id));
  await Redis.srem(HABITS_SET(userId), id);

  const sel = await Redis.get(SELECTED_KEY(userId));
  if (sel === id) await Redis.del(SELECTED_KEY(userId));

  const daysIndex = `habit:${id}:days`;
  const dayKeys = await Redis.zrange(daysIndex, 0, -1);

  // parse criteria for cleanup
  let crits: HabitCriterion[] = [];
  if (h?.criteria) {
    try { const arr = JSON.parse(h.criteria); if (Array.isArray(arr)) crits = arr; } catch {}
  }

  if (dayKeys?.length) {
    const multi: any[] = [];
    for (const dayKey of dayKeys) {
      await clearRepeatJob(id, dayKey);
      await clearGoalJob(id, dayKey);
      for (const c of crits) await clearCriterionGoalJob(id, dayKey, c.id);
      multi.push(["del", `habit:${id}:day:${dayKey}`]);
      multi.push(["del", `habit:${id}:day:${dayKey}:segments`]);
      for (const c of crits) {
        multi.push(["del", `habit:${id}:day:${dayKey}:segments:crit:${c.id}`]);
      }
    }
    await (Redis as any).multi(multi).exec();
  }
  await Redis.del(daysIndex);
}

async function getSelected(userId: string) {
  return await Redis.get(SELECTED_KEY(userId));
}

async function setSelected(userId: string, habitId: string) {
  await Redis.set(SELECTED_KEY(userId), habitId);
}

/* ---------- TODAY filter (lenient) ---------- */
async function filterTodayRelevant(userId: string, habits: Habit[]) {
  if (!habits.length) return habits;

  const today = serverLocalDayKey();
  const multi: any[] = [];

  for (const h of habits) {
    multi.push(["hgetall", `habit:${h.id}:day:${today}`]); // idx 2*i
    multi.push(["llen", `habit:${h.id}:day:${today}:segments`]); // idx 2*i+1
  }

  const rows = await (Redis as any).multi(multi).exec();
  const keep = new Set<string>();

  for (let i = 0; i < habits.length; i++) {
    const stHash = rows[2 * i]?.[1] as any;
    const segLen = Number(rows[2 * i + 1]?.[1] ?? 0);
    const status = stHash?.status as string | undefined;
    const hasState = !!status;
    const show = segLen > 0 || !hasState || status !== "canceled";
    if (show) keep.add(habits[i].id);
  }

  return habits.filter((h) => keep.has(h.id));
}

/* ───────────── Habits routes ───────────── */
router.get("/stopwatch/habits", async (req: Request, res: Response) => {
  try {
    const { userId } = req.query as any;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }

    const all = await listHabits(userId);
    const bypass = String((req.query as any).all || "") === "1";
    const habits = bypass ? all : await filterTodayRelevant(userId, all);
    const selected = await getSelected(userId);

    res.json({ habits, selected });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/stopwatch/habits", async (req: Request, res: Response) => {
  try {
    const { userId, id, title, minutes, criteria } = req.body || {};
    if (!userId || !title) { res.status(400).json({ error: "userId and title required" }); return; }

    const habit = await upsertHabit(userId, { id, title, minutes, criteria });
    const sel = await getSelected(userId);
    if (!sel) await setSelected(userId, habit.id);

    res.status(id ? 200 : 201).json({ habit });
  } catch (e: any) {
    if (e?.code === "DUPLICATE_TITLE") {
      res.status(409).json({ error: "duplicate_title", msg: "A habit with that title already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/stopwatch/habits/:id", async (req: Request, res: Response) => {
  try {
    const { userId } = req.query as any;
    const { id } = req.params;
    if (!userId || !id) { res.status(400).json({ error: "userId and id required" }); return; }

    await deleteHabit(userId, id);
    const items = await listHabits(userId);
    if (items.length && !(await getSelected(userId))) await setSelected(userId, items[0].id);

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/stopwatch/habits/selected", async (req: Request, res: Response) => {
  try {
    const { userId } = req.query as any;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const id = await getSelected(userId);
    res.json({ habitId: id || null });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/stopwatch/habits/selected", async (req: Request, res: Response) => {
  try {
    const { userId, habitId } = req.body || {};
    if (!userId || !habitId) { res.status(400).json({ error: "userId and habitId required" }); return; }
    await setSelected(userId, habitId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ───────────── Timer routes (criterion-aware, back-compatible) ───────────── */
async function getTimerState(req: Request, res: Response) {
  try {
    const { habitId, userId } = req.query as any;
    const minDailyMs = Number((req.query as any).minDailyMs ?? 0);
    const criterionId = (req.query as any).criterionId as string | undefined;
    let dayKey = normalizeDayKey((req.query as any).dayKey);

    if (!habitId || !userId || !dayKey) { res.status(400).json({ error: "habitId,userId,dayKey required" }); return; }

    let day = await loadDay(habitId, dayKey);
    if (!day) day = await createDay({ habitId, userId, dayKey, minDailyMs });

    const segments = criterionId
      ? await getCriterionSegments(habitId, dayKey, String(criterionId))
      : await getSegments(habitId, dayKey);

    res.json({ day, segments });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function startTimer(req: Request, res: Response) {
  try {
    const { habitId, userId, minDailyMs, criterionId } = req.body || {};
    let dayKey = normalizeDayKey((req.body || {}).dayKey);

    if (!habitId || !userId || !dayKey) { res.status(400).json({ error: "missing fields" }); return; }

    let day = await loadDay(habitId, dayKey);
    if (!day) day = await createDay({ habitId, userId, dayKey, minDailyMs });

    if (day.status === "running") {
      const segments = criterionId
        ? await getCriterionSegments(habitId, dayKey, String(criterionId))
        : await getSegments(habitId, dayKey);
      res.json({ day, segments });
      return;
    }

    const now = Date.now();
    day.status = "running";
    day.startedAt = now;
    day.lastConfirmAt = now;
    day.currentCriterionId = criterionId ? String(criterionId) : null;

    if (criterionId) {
      await appendOpenCriterionSegment(habitId, dayKey, String(criterionId), now);
    } else {
      await appendOpenSegment(habitId, dayKey, now);
    }

    await saveDay(day);
    await ensureRepeatJob({ habitId, dayKey, userId });

    if (criterionId) {
      await ensureCriterionGoalJob({ habitId, dayKey, userId, criterionId: String(criterionId) });
    } else {
      await ensureGoalJob({ habitId, dayKey, userId }, day.progressMs, day.minDailyMs);
    }

    const segments = criterionId
      ? await getCriterionSegments(habitId, dayKey, String(criterionId))
      : await getSegments(habitId, dayKey);
    res.json({ day, segments });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function stopTimer(req: Request, res: Response) {
  try {
    const { habitId, criterionId } = req.body || {};
    let dayKey = normalizeDayKey((req.body || {}).dayKey);

    const day = await loadDay(habitId, dayKey);
    if (!day) { res.sendStatus(404); return; }

    const now = Date.now();
    const activeCrit = String(criterionId || day.currentCriterionId || "");

    if (activeCrit) {
      await closeOpenCriterionSegment(habitId, dayKey, activeCrit, now);

      const segs = await getCriterionSegments(habitId, dayKey, activeCrit);
      day.progressMs = await overallProgressMs(day.userId, habitId, dayKey);
      day.startedAt = null;
      day.status = (await allCriteriaMet(day.userId, habitId, dayKey)) ? "completed" : "paused";

      await saveDay(day);
      await clearRepeatJob(habitId, dayKey);
      await clearGoalJob(habitId, dayKey);
      await clearCriterionGoalJob(habitId, dayKey, activeCrit);

      res.json({ day, segments: segs });
      return;
    }

    // legacy path
    await closeOpenSegment(habitId, dayKey, now);

    const segs = await getSegments(habitId, dayKey);
    day.progressMs = sumSegments(segs);
    day.startedAt = null;
    day.status = day.progressMs >= day.minDailyMs ? "completed" : "paused";

    await saveDay(day);
    await clearRepeatJob(habitId, dayKey);
    await clearGoalJob(habitId, dayKey);

    res.json({ day, segments: segs });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function confirmTimer(req: Request, res: Response) {
  try {
    const { habitId } = req.body || {};
    let dayKey = normalizeDayKey((req.body || {}).dayKey);

    const day = await loadDay(habitId, dayKey);
    if (!day) { res.sendStatus(404); return; }

    if (day.status === "running") {
      day.lastConfirmAt = Date.now();
      await saveDay(day);
    }

    const segments = day.currentCriterionId
      ? await getCriterionSegments(habitId, dayKey, String(day.currentCriterionId))
      : await getSegments(habitId, dayKey);

    res.json({ day, segments });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function adjustTimer(req: Request, res: Response) {
  try {
    const { habitId, minusMs, criterionId } = req.body || {};
    let dayKey = normalizeDayKey((req.body || {}).dayKey);

    const day = await loadDay(habitId, dayKey);
    if (!day) { res.sendStatus(404); return; }

    const activeCrit = String(criterionId || day.currentCriterionId || "");
    if (activeCrit) {
      await shrinkLastCriterionSegment(habitId, dayKey, activeCrit, Number(minusMs || 0));
      const segs = await getCriterionSegments(habitId, dayKey, activeCrit);
      day.progressMs = await overallProgressMs(day.userId, habitId, dayKey);
      day.status = (await allCriteriaMet(day.userId, habitId, dayKey)) ? "completed" :
        (day.startedAt ? "running" : "paused");
      await saveDay(day);
      await ensureCriterionGoalJob({ habitId, dayKey, userId: day.userId, criterionId: activeCrit });
      res.json({ day, segments: segs });
      return;
    }

    // legacy
    await shrinkLastSegment(habitId, dayKey, Number(minusMs || 0));
    const segs = await getSegments(habitId, dayKey);
    day.progressMs = sumSegments(segs);
    day.status = day.progressMs >= day.minDailyMs ? "completed" : (day.startedAt ? "running" : "paused");

    await saveDay(day);
    await ensureGoalJob({ habitId, dayKey, userId: day.userId }, day.progressMs, day.minDailyMs);

    res.json({ day, segments: segs });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function resetTimer(req: Request, res: Response) {
  try {
    const { habitId } = req.body || {};
    let dayKey = normalizeDayKey((req.body || {}).dayKey);

    const day = await loadDay(habitId, dayKey);
    if (!day) { res.sendStatus(404); return; }

    await clearRepeatJob(habitId, dayKey);
    await clearGoalJob(habitId, dayKey);
    await clearAllSegments(habitId, dayKey);

    day.progressMs = 0;
    day.startedAt = null;
    day.status = "canceled";

    await saveDay(day);
    res.json({ day, segments: [] });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}

router.get("/stopwatch/state", getTimerState);
router.post("/stopwatch/start", startTimer);
router.post("/stopwatch/stop", stopTimer);
router.post("/stopwatch/confirm", confirmTimer);
router.post("/stopwatch/adjust", adjustTimer);
router.post("/stopwatch/reset", resetTimer);

export default router;

