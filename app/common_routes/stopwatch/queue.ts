// app/common_routes/stopwatch/queue.ts
import { Queue, Worker } from "bullmq";
import { BullRedis as Redis } from "../../../lib/bullRedis.ts";

/** ────────────── CONFIG ────────────── */
let CONFIRM_INTERVAL_MS = Number(process.env.CONFIRM_INTERVAL_MS ?? 5 * 60_000); // 5m
if (process.env.ENVIRONMENT === "development") {
  CONFIRM_INTERVAL_MS = Number(process.env.CONFIRM_INTERVAL_MS ?? 2 * 60_000); // 2m
}
export const CONFIRM_GRACE_MS = Number(process.env.CONFIRM_GRACE_MS ?? 0);
const STREAKS_URL = process.env.STREAKS_URL || "http://localhost:3000/streaks";
const connection: any = Redis;

/** ────────────── TYPES (kept inline like original) ────────────── */
export type HabitCriterion = { id: string; title: string; minutes: number };

export type DayTracker = {
  habitId: string;
  userId: string;
  dayKey: string; // "YYYY-MM-DD"
  status: "running" | "paused" | "completed" | "canceled";
  minDailyMs: number;
  progressMs: number;
  startedAt: number | null;
  lastConfirmAt: number | null;
  currentCriterionId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Segment = { startMs: number; endMs: number | null };

export type NudgeJob = {
  habitId: string;
  dayKey: string;
  userId: string;
  criterionId?: string | null;
};

/** ────────────── KEYS ────────────── */
const dayHashKey = (habitId: string, dayKey: string) => `habit:${habitId}:day:${dayKey}`;
const segmentsListKey = (habitId: string, dayKey: string) => `${dayHashKey(habitId, dayKey)}:segments`;
const critSegmentsListKey = (habitId: string, dayKey: string, critId: string) =>
  `${segmentsListKey(habitId, dayKey)}:crit:${critId}`;
const daysIndexKey = (habitId: string) => `habit:${habitId}:days`;
const successFlagKey = (habitId: string, dayKey: string) => `${dayHashKey(habitId, dayKey)}:success`;
const HABIT_HASH = (userId: string, habitId: string) => `stopwatch:${userId}:habit:${habitId}`;

/** ────────────── STORE HELPERS ────────────── */
function epochForDayKey(dayKey: string) {
  const [Y, M, D] = dayKey.split("-").map(Number);
  return Date.UTC(Y, (M || 1) - 1, D || 1, 0, 0, 0, 0);
}

export async function loadDay(habitId: string, dayKey: string): Promise<DayTracker | null> {
  const h = await Redis.hgetall(dayHashKey(habitId, dayKey));
  if (!h || !h.status) return null;
  return {
    habitId,
    userId: h.userId,
    dayKey,
    status: h.status as any,
    minDailyMs: Number(h.minDailyMs || 0),
    progressMs: Number(h.progressMs || 0),
    startedAt: h.startedAt ? Number(h.startedAt) : null,
    lastConfirmAt: h.lastConfirmAt ? Number(h.lastConfirmAt) : null,
    currentCriterionId: h.currentCriterionId || null,
    createdAt: Number(h.createdAt || Date.now()),
    updatedAt: Number(h.updatedAt || Date.now()),
  };
}

export async function saveDay(d: DayTracker) {
  d.updatedAt = Date.now();
  await Redis.hset(dayHashKey(d.habitId, d.dayKey), {
    userId: d.userId,
    status: d.status,
    minDailyMs: String(d.minDailyMs),
    progressMs: String(d.progressMs),
    startedAt: d.startedAt ? String(d.startedAt) : "",
    lastConfirmAt: d.lastConfirmAt ? String(d.lastConfirmAt) : "",
    currentCriterionId: d.currentCriterionId || "",
    createdAt: String(d.createdAt),
    updatedAt: String(d.updatedAt),
  });
  await Redis.zadd(daysIndexKey(d.habitId), epochForDayKey(d.dayKey), d.dayKey);
}

export async function createDay(args: {
  habitId: string;
  userId: string;
  dayKey: string;
  minDailyMs: number;
}) {
  const now = Date.now();
  const d: DayTracker = {
    habitId: args.habitId,
    userId: args.userId,
    dayKey: args.dayKey,
    status: "paused",
    minDailyMs: args.minDailyMs,
    progressMs: 0,
    startedAt: null,
    lastConfirmAt: null,
    currentCriterionId: null,
    createdAt: now,
    updatedAt: now,
  };
  await saveDay(d);
  return d;
}

/** ────────────── SEGMENTS (parent) ────────────── */
export async function getSegments(habitId: string, dayKey: string): Promise<Segment[]> {
  const raw = await Redis.lrange(segmentsListKey(habitId, dayKey), 0, -1);
  return raw.map((s) => JSON.parse(s));
}

export async function appendOpenSegment(habitId: string, dayKey: string, startMs: number) {
  const seg: Segment = { startMs, endMs: null };
  await Redis.rpush(segmentsListKey(habitId, dayKey), JSON.stringify(seg));
}

export async function closeOpenSegment(habitId: string, dayKey: string, endMs: number) {
  const key = segmentsListKey(habitId, dayKey);
  const last = await Redis.lindex(key, -1);
  if (!last) return;
  const seg: Segment = JSON.parse(last);
  if (seg.endMs != null) return;
  seg.endMs = Math.max(seg.startMs, endMs);
  await Redis.lset(key, -1, JSON.stringify(seg));
}

/** ────────────── SEGMENTS (criterion) ────────────── */
export async function getCriterionSegments(habitId: string, dayKey: string, critId: string): Promise<Segment[]> {
  const raw = await Redis.lrange(critSegmentsListKey(habitId, dayKey, critId), 0, -1);
  return raw.map((s) => JSON.parse(s));
}

export async function appendOpenCriterionSegment(habitId: string, dayKey: string, critId: string, startMs: number) {
  const seg: Segment = { startMs, endMs: null };
  await Redis.rpush(critSegmentsListKey(habitId, dayKey, critId), JSON.stringify(seg));
}

export async function closeOpenCriterionSegment(habitId: string, dayKey: string, critId: string, endMs: number) {
  const key = critSegmentsListKey(habitId, dayKey, critId);
  const last = await Redis.lindex(key, -1);
  if (!last) return;
  const seg: Segment = JSON.parse(last);
  if (seg.endMs != null) return;
  seg.endMs = Math.max(seg.startMs, endMs);
  await Redis.lset(key, -1, JSON.stringify(seg));
}

/** ────────────── SUM/SHRINK ────────────── */
export function sumSegments(segs: Segment[], now = Date.now()) {
  return segs.reduce((a, s) => a + Math.max(0, (s.endMs ?? now) - s.startMs), 0);
}

export async function shrinkLastSegment(habitId: string, dayKey: string, minusMs: number) {
  const key = segmentsListKey(habitId, dayKey);
  const last = await Redis.lindex(key, -1);
  if (!last) return;
  const seg: Segment = JSON.parse(last);
  if (seg.endMs == null) seg.endMs = Date.now();
  seg.endMs = Math.max(seg.startMs, seg.endMs - Math.max(0, minusMs));
  await Redis.lset(key, -1, JSON.stringify(seg));
}

export async function shrinkLastCriterionSegment(habitId: string, dayKey: string, critId: string, minusMs: number) {
  const key = critSegmentsListKey(habitId, dayKey, critId);
  const last = await Redis.lindex(key, -1);
  if (!last) return;
  const seg: Segment = JSON.parse(last);
  if (seg.endMs == null) seg.endMs = Date.now();
  seg.endMs = Math.max(seg.startMs, seg.endMs - Math.max(0, minusMs));
  await Redis.lset(key, -1, JSON.stringify(seg));
}

/** Clear ALL segments for a day (used by kill switch) */
export async function clearAllSegments(habitId: string, dayKey: string) {
  await Redis.del(segmentsListKey(habitId, dayKey));
  // also clear criterion lists if present
  const dayHash = await Redis.hgetall(dayHashKey(habitId, dayKey));
  const userId = dayHash?.userId;
  if (userId) {
    const h = await Redis.hgetall(HABIT_HASH(userId, habitId));
    if (h?.criteria) {
      try {
        const arr: HabitCriterion[] = JSON.parse(h.criteria);
        for (const c of Array.isArray(arr) ? arr : []) {
          await Redis.del(critSegmentsListKey(habitId, dayKey, c.id));
        }
      } catch {}
    }
  }
}

/** ────────────── PUSH STUBS ────────────── */
async function sendConfirmPush(opts: { userId: string; habitId: string; dayKey: string }) {
  console.log("[push] confirm", opts);
}
async function sendPausedPush(opts: { userId: string; habitId: string; dayKey: string }) {
  console.log("[push] paused", opts);
}

/** ────────────── HABIT CONFIG ────────────── */
type HabitConfig = { title: string; minutes: number; criteria?: HabitCriterion[] };

async function getHabitConfig(userId: string, habitId: string): Promise<HabitConfig> {
  const h = await Redis.hgetall(HABIT_HASH(userId, habitId));
  const base: HabitConfig = {
    title: (h?.title as string) || habitId,
    minutes: Number(h?.minutes || 0),
  };
  if (h?.criteria) {
    try {
      const parsed = JSON.parse(h.criteria as string);
      if (Array.isArray(parsed)) base.criteria = parsed.filter(Boolean);
    } catch {}
  }
  return base;
}
function hasCriteria(cfg: HabitConfig) {
  return Array.isArray(cfg.criteria) && cfg.criteria.length > 0;
}

/** aggregation helpers */
export async function overallProgressMs(userId: string, habitId: string, dayKey: string): Promise<number> {
  const cfg = await getHabitConfig(userId, habitId);
  if (hasCriteria(cfg)) {
    let total = 0;
    for (const c of cfg.criteria!) {
      total += sumSegments(await getCriterionSegments(habitId, dayKey, c.id));
    }
    return total;
  }
  return sumSegments(await getSegments(habitId, dayKey));
}
export async function allCriteriaMet(userId: string, habitId: string, dayKey: string): Promise<boolean> {
  const cfg = await getHabitConfig(userId, habitId);
  if (!hasCriteria(cfg)) return false;
  for (const c of cfg.criteria!) {
    const need = Math.max(0, Number(c.minutes || 0)) * 60_000;
    const have = sumSegments(await getCriterionSegments(habitId, dayKey, c.id));
    if (have < need) return false;
  }
  return true;
}


// async function earliestStartDateISO(userId: string, habitId: string, dayKey: string): Promise<string> {
//   const cfg = await getHabitConfig(userId, habitId);
//   let earliest: number | null = null;

//   if (hasCriteria(cfg)) {
//     for (const c of cfg.criteria!) {
//       const segs = await getCriterionSegments(habitId, dayKey, c.id);
//       if (segs.length) earliest = Math.min(earliest ?? Infinity, segs[0].startMs);
//     }
//   } else {
//     const segs = await getSegments(habitId, dayKey);
//     if (segs.length) earliest = segs[0].startMs;
//   }

//   if (!earliest) return dayKey;
//   const d = new Date(earliest);
//   const y = d.getUTCFullYear();
//   const m = String(d.getUTCMonth() + 1).padStart(2, "0");
//   const dd = String(d.getUTCDate()).padStart(2, "0");
//   return `${y}-${m}-${dd}`;
// }
/** ────────────── REPLACE THIS FUNCTION ────────────── */
/** Report the day the session STARTED: just use the bucket dayKey. */
async function earliestStartDateISO(
  userId: string,
  habitId: string,
  dayKey: string
): Promise<string> {
  // dayKey is the canonical "start day" bucket for this run.
  // This avoids UTC/local conversions and midnight-crossing edge cases.
  return dayKey;
}

/** ────────────── STREAKS (same server) ────────────── */
async function getActivityLabel(userId: string, habitId: string): Promise<string> {
  const h = await Redis.hgetall(HABIT_HASH(userId, habitId));
  return (h?.title as string) || habitId;
}
async function successAlreadyFired(habitId: string, dayKey: string) {
  return (await Redis.get(successFlagKey(habitId, dayKey))) === "1";
}
async function setSuccessFired(habitId: string, dayKey: string) {
  await Redis.set(successFlagKey(habitId, dayKey), "1");
}

async function markStreakSuccess(userId: string, habitId: string, dayKey: string) {
  if (await successAlreadyFired(habitId, dayKey)) return;

  const activity = await getActivityLabel(userId, habitId);
  const sessionStartDate = await earliestStartDateISO(userId, habitId, dayKey);

  try {
    console.log(`[streaks] mark success: ${activity} (${habitId}) on ${sessionStartDate}`);
    await fetch(STREAKS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "addSuccessfulDate", activity, date: sessionStartDate }),
    });
    await setSuccessFired(habitId, dayKey);
  } catch (e) {
    console.error("[streaks] failed", (e as Error).message);
  }
}

/** ────────────── BULLMQ REPEAT + GOAL JOB ────────────── */
export const nudgesQueue = new Queue<NudgeJob>("stopwatch-nudges", { connection });
const REPEAT_NAME = "confirm";
const GOAL_NAME = "goal";

/** Ensure one repeat job per (habitId, dayKey) */
export async function ensureRepeatJob(data: NudgeJob) {
  const jobId = `${data.habitId}:${data.dayKey}`;
  const existing = await nudgesQueue.getRepeatableJobs();
  const found = existing.find((r) => {
    const every = Number((r as any).every ?? (r as any).opts?.every ?? 0);
    return r.name === REPEAT_NAME && r.id === jobId && every === CONFIRM_INTERVAL_MS;
  });
  if (found) return;

  for (const r of existing) {
    if (r.name === REPEAT_NAME && r.id === jobId) {
      await nudgesQueue.removeRepeatableByKey(r.key);
    }
  }

  await nudgesQueue.add(REPEAT_NAME, data, {
    jobId,
    removeOnComplete: true,
    removeOnFail: true,
    repeat: { every: CONFIRM_INTERVAL_MS, jobId },
  });
}

export async function clearRepeatJob(habitId: string, dayKey: string) {
  const jobId = `${habitId}:${dayKey}`;
  const reps = await nudgesQueue.getRepeatableJobs();
  for (const r of reps) {
    if (r.name === REPEAT_NAME && r.id === jobId) {
      await nudgesQueue.removeRepeatableByKey(r.key);
    }
  }
}

/** Legacy parent goal: fires when parent progress meets minDailyMs (kept for habits without criteria) */
export async function ensureGoalJob(data: NudgeJob, currentProgressMs: number, minDailyMs: number) {
  const jobId = `goal:${data.habitId}:${data.dayKey}`;
  const remaining = Math.max(0, minDailyMs - currentProgressMs);

  if (remaining === 0) {
    await markStreakSuccess(data.userId, data.habitId, data.dayKey);
    return;
  }

  try { await nudgesQueue.remove(jobId); } catch {}

  await nudgesQueue.add(GOAL_NAME, data, {
    jobId,
    delay: remaining,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/** Per-criterion goal: schedule against a single criterion’s minutes */
export async function ensureCriterionGoalJob(data: NudgeJob & { criterionId: string }) {
  const h = await Redis.hgetall(HABIT_HASH(data.userId, data.habitId));
  let crits: HabitCriterion[] = [];
  if (h?.criteria) {
    try { const arr = JSON.parse(h.criteria); if (Array.isArray(arr)) crits = arr; } catch {}
  }
  const crit = crits.find((c) => c.id === data.criterionId);
  if (!crit) return;

  const segs = await getCriterionSegments(data.habitId, data.dayKey, crit.id);
  const have = sumSegments(segs);
  const need = Math.max(1, Number(crit.minutes || 1)) * 60_000;
  const remaining = Math.max(0, need - have);

  const jobId = `goal:${data.habitId}:${data.dayKey}:crit:${crit.id}`;
  try { await nudgesQueue.remove(jobId); } catch {}

  if (remaining === 0) {
    if (await allCriteriaMet(data.userId, data.habitId, data.dayKey)) {
      await markStreakSuccess(data.userId, data.habitId, data.dayKey);
    }
    return;
  }

  await nudgesQueue.add(GOAL_NAME, data, {
    jobId,
    delay: remaining,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export async function clearGoalJob(habitId: string, dayKey: string) {
  const jobId = `goal:${habitId}:${dayKey}`;
  try { await nudgesQueue.remove(jobId); } catch {}
}
export async function clearCriterionGoalJob(habitId: string, dayKey: string, criterionId: string) {
  const jobId = `goal:${habitId}:${dayKey}:crit:${criterionId}`;
  try { await nudgesQueue.remove(jobId); } catch {}
}

/** Worker: confirm pings + auto-stop with (interval + grace) timeout */
export const nudgesWorker = new Worker<NudgeJob>(
  "stopwatch-nudges",
  async (job) => {
    if (job.name === REPEAT_NAME) {
      const { habitId, dayKey, userId } = job.data;
      const day = await loadDay(habitId, dayKey);
      if (!day || day.status !== "running" || !day.lastConfirmAt) return;

      const now = Date.now();
      const deadline = day.lastConfirmAt + CONFIRM_INTERVAL_MS + CONFIRM_GRACE_MS;

      await sendConfirmPush({ userId, habitId, dayKey });

      if (now >= deadline && day.lastConfirmAt <= deadline - (CONFIRM_INTERVAL_MS + 1)) {
        const truncateAt = day.lastConfirmAt + CONFIRM_INTERVAL_MS;

        // close whichever is running (criterion-first if set)
        const activeCrit = day.currentCriterionId;
        if (activeCrit) {
          await closeOpenCriterionSegment(habitId, dayKey, activeCrit, truncateAt);
        } else {
          await closeOpenSegment(habitId, dayKey, truncateAt);
        }

        // recompute totals + status
        day.progressMs = await overallProgressMs(userId, habitId, dayKey);
        day.startedAt = null;

        if (await allCriteriaMet(userId, habitId, dayKey)) {
          day.status = "completed";
          await saveDay(day);
          await markStreakSuccess(userId, habitId, dayKey);
        } else {
          // legacy path (no criteria met logic)
          if (!(await hasCriteria(await getHabitConfig(userId, habitId)))) {
            const segs = await getSegments(habitId, dayKey);
            day.status = sumSegments(segs) >= day.minDailyMs ? "completed" : "paused";
            await saveDay(day);
            if (day.status === "completed") await markStreakSuccess(userId, habitId, dayKey);
          } else {
            day.status = "paused";
            await saveDay(day);
          }
        }

        await sendPausedPush({ userId, habitId, dayKey });
        await clearRepeatJob(habitId, dayKey);

        // clear any scheduled goals
        await clearGoalJob(habitId, dayKey);
        const cfg = await getHabitConfig(userId, habitId);
        if (hasCriteria(cfg)) {
          for (const c of cfg.criteria!) await clearCriterionGoalJob(habitId, dayKey, c.id);
        }
      }
      return;
    }

    if (job.name === GOAL_NAME) {
      const { habitId, dayKey, userId, criterionId } = job.data;

      // If this was a criterion goal job, success only when all criteria are met.
      if (criterionId) {
        if (await allCriteriaMet(userId, habitId, dayKey)) {
          await markStreakSuccess(userId, habitId, dayKey);
        }
        return;
      }

      // Legacy: parent goal
      const day = await loadDay(habitId, dayKey);
      if (!day) return;
      const segs = await getSegments(habitId, dayKey);
      if (sumSegments(segs) >= day.minDailyMs) {
        await markStreakSuccess(userId, habitId, dayKey);
      }
      return;
    }
  },
  { connection }
);


