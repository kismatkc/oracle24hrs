import express, { Request, Response } from "express";
import { Redis } from "../../../lib/reddis.ts";

const router = express.Router();

/* ---------- redis key helpers ---------- */
const successKey = (a: string) => `activity:${a}:successful`;
const failureKey = (a: string) => `activity:${a}:failure`;
const streakKey = (a: string) => `streak:${a}`;

/* ---------- list helpers ---------- */
const addSuccessfulDate = (a: string, d: string) =>
  Redis.lpush(successKey(a), d);
const addFailureDate = (a: string, d: string) => Redis.lpush(failureKey(a), d);
const getSuccessfulDates = (a: string) => Redis.lrange(successKey(a), 0, -1);
const getFailureDates = (a: string) => Redis.lrange(failureKey(a), 0, -1);
const deleteSuccessLists = (a: string) => Redis.del(successKey(a));
const deleteFailureLists = (a: string) => Redis.del(failureKey(a));

/* ---------- streak helpers ---------- */
async function addStreak(
  activity: string,
  label: string,
  conditions: string[]
) {
  await Redis.hset(streakKey(activity), {
    label,
    conditions: JSON.stringify(conditions),
  });
}
async function getStreak(activity: string) {
  const h = await Redis.hgetall(streakKey(activity));
  if (!h?.label) return null;
  return {
    activity,
    label: h.label,
    conditions: JSON.parse(h.conditions || "[]"),
  };
}
async function getAllStreaks() {
  const keys = await Redis.keys("streak:*");
  const pipeline = keys.map((k) => ["hgetall", k] as const);
  const rows = await (Redis as any).multi(pipeline).exec();
  return rows.map(([, h]: any, i: number) => ({
    activity: keys[i].replace("streak:", ""),
    label: h.label,
    conditions: JSON.parse(h.conditions || "[]"),
  }));
}
async function deleteStreak(activity: string) {
  await Redis.del(streakKey(activity));
  await deleteSuccessLists(activity);
  await deleteFailureLists(activity);
}

/* ---------- master POST controller ---------- */
async function streaks(req: Request, res: Response) {
  try {
    const { event, activity, date, label, conditions } = req.body as any;

    if (event === "addSuccessfulDate") {
      await addSuccessfulDate(activity, date);
    } else if (event === "addFailureDate") {
      await addFailureDate(activity, date);
    } else if (event === "getSuccessfulDates") {
      res.json({ success: true, data: await getSuccessfulDates(activity) });
      return;
    } else if (event === "getFailureDates") {
      res.json({ success: true, data: await getFailureDates(activity) });
      return;
    } else if (event === "deleteSuccessList") {
      await deleteSuccessLists(activity);
    } else if (event === "deleteFailureList") {
      await deleteFailureLists(activity);
    } else if (event === "addStreak") {
      /* NEW LOGIC: title must be unique */
      if (!label) {
        res.status(400).json({ success: false, msg: "label required" });
        return;
      }
      const key = streakKey(label);
      const exists = await Redis.exists(key);
      if (exists) {
        res.status(409).json({
          success: false,
          msg: "A habit with that title already exists",
        });
        return;
      }
      await addStreak(
        label, // use label as redis key
        label,
        Array.isArray(conditions) ? conditions : []
      );
    } else if (event === "getStreak") {
      res.json({ success: true, data: await getStreak(activity) });
      return;
    } else if (event === "getAllStreaks") {
      res.json({ success: true, data: await getAllStreaks() });
      return;
    } else if (event === "deleteStreak") {
      await deleteStreak(activity);
    } else {
      res.status(400).json({ success: false, msg: "Unknown event" });
      return;
    }

    res.status(201).json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
}

/* ---------- REST‑style DELETE route ---------- */
router.delete("/streaks/:activity", async (req: Request, res: Response) => {
  try {
    const { activity } = req.params;
    await deleteStreak(activity);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

router.post("/streaks", streaks);
export default router;
