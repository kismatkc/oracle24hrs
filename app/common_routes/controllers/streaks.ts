
import express, { Request, Response } from "express";
import { RedisClient as Redis } from "../../../lib/reddis.ts";

const router = express.Router();

/* ---------- redis key helpers ---------- */
const successKey = (a: string) => `activity:${a}:successful`;
const failureKey = (a: string) => `activity:${a}:failure`;
const streakKey = (a: string) => `streak:${a}`;

/* ---------- list helpers ---------- */
const addSuccessfulDate = (a: string, d: string) => Redis.lpush(successKey(a), d);
const addFailureDate = (a: string, d: string) => Redis.lpush(failureKey(a), d);
const getSuccessfulDates = (a: string) => Redis.lrange(successKey(a), 0, -1);
const getFailureDates = (a: string) => Redis.lrange(failureKey(a), 0, -1);
const deleteSuccessLists = (a: string) => Redis.del(successKey(a));
const deleteFailureLists = (a: string) => Redis.del(failureKey(a));

/* ---------- streak helpers ---------- */
async function addStreak(activity: string, label: string, conditions: string[]) {
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
    info_label: h.info_label,   // legacy
    info_date: h.info_date,     // legacy
  };
}
async function getAllStreaks() {
  const keys = await Redis.keys("streak:*");
  if (keys.length === 0) return [];
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
async function renameActivity(oldName: string, newName: string) {
  await Redis.rename(streakKey(oldName), streakKey(newName));
  try { await Redis.rename(successKey(oldName), successKey(newName)); } catch {}
  try { await Redis.rename(failureKey(oldName), failureKey(newName)); } catch {}
}

/* ---------- optional info (multiple items) ---------- */
type InfoItem = { id: string; label: string; date: string | null };

const nowId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function readItems(activity: string): Promise<InfoItem[]> {
  const h = await Redis.hgetall(streakKey(activity));
  if (!h) return [];

  // New store
  const items: InfoItem[] = h.info_items ? JSON.parse(h.info_items) : [];

  // Back-compat: expose legacy single fields as a one-off item
  if (!items.length && (h.info_label || h.info_date)) {
    if (h.info_label) {
      items.push({ id: "legacy", label: h.info_label, date: h.info_date ?? null });
    }
  }
  return items;
}
async function writeItems(activity: string, items: InfoItem[]) {
  await Redis.hset(streakKey(activity), { info_items: JSON.stringify(items) });
  // Clean legacy keys to prevent confusion
  await Redis.hdel(streakKey(activity), "info_label", "info_date");
}

async function upsertOptionalInfoH(activity: string, label: string, date: string | null) {
  const exists = await Redis.exists(streakKey(activity));
  if (!exists) return { ok: false as const };

  const items = await readItems(activity);
  const item: InfoItem = { id: nowId(), label, date: date ?? null };
  items.push(item);
  await writeItems(activity, items);
  return { ok: true as const, item };
}
async function getOptionalInfoH(activity: string) {
  const exists = await Redis.exists(streakKey(activity));
  if (!exists) return null;
  return await readItems(activity);
}
async function clearOptionalInfoH(activity: string, id?: string) {
  const exists = await Redis.exists(streakKey(activity));
  if (!exists) return false;

  if (!id) {
    await writeItems(activity, []);
    return true;
  }
  const items = await readItems(activity);
  const filtered = items.filter((x) => x.id !== id);
  await writeItems(activity, filtered);
  return true;
}

/* ---------- master POST controller ---------- */
async function streaks(req: Request, res: Response) {
  try {
    const { event } = req.body as any;

    if (event === "addSuccessfulDate") {
      const { activity, date } = req.body as any;
      await addSuccessfulDate(activity, date);
    } else if (event === "addFailureDate") {
      const { activity, date } = req.body as any;
      await addFailureDate(activity, date);
    } else if (event === "getSuccessfulDates") {
      const { activity } = req.body as any;
      res.json({ success: true, data: await getSuccessfulDates(activity) });
      return;
    } else if (event === "getFailureDates") {
      const { activity } = req.body as any;
      res.json({ success: true, data: await getFailureDates(activity) });
      return;
    } else if (event === "addStreak") {
      const { label, conditions } = req.body as any;
      if (!label) { res.status(400).json({ success: false, msg: "label required" }); return; }
      const key = streakKey(label);
      const exists = await Redis.exists(key);
      if (exists) { res.status(409).json({ success: false, msg: "A habit with that title already exists" }); return; }
      await addStreak(label, label, Array.isArray(conditions) ? conditions : []);
    } else if (event === "updateStreak") {
      const { original, label, conditions } = req.body as any;
      if (!original) { res.status(400).json({ success: false, msg: "original required" }); return; }
      const current = await getStreak(original);
      if (!current) { res.status(404).json({ success: false, msg: "not found" }); return; }
      const newLabel = label?.trim() || original;
      const newConds = Array.isArray(conditions) ? conditions : [];
      if (newLabel === original && JSON.stringify(newConds) === JSON.stringify(current.conditions || [])) {
        res.json({ success: true, updated: false }); return;
      }
      if (newLabel !== original) {
        const dup = await Redis.exists(streakKey(newLabel));
        if (dup) { res.status(409).json({ success: false, msg: "A habit with that title already exists" }); return; }
        await renameActivity(original, newLabel);
      }
      await Redis.hset(streakKey(newLabel), { label: newLabel, conditions: JSON.stringify(newConds) });
    } else if (event === "getStreak") {
      const { activity } = req.body as any;
      res.json({ success: true, data: await getStreak(activity) }); return;
    } else if (event === "getAllStreaks") {
      res.json({ success: true, data: await getAllStreaks() }); return;
    } else if (event === "deleteStreak") {
      const { activity } = req.body as any;
      await deleteStreak(activity);
    } else if (event === "deleteSuccessList") {
      const { activity } = req.body as any;
      await deleteSuccessLists(activity);
    } else if (event === "deleteFailureList") {
      const { activity } = req.body as any;
      await deleteFailureLists(activity);

      /* ---------- OPTIONAL INFO (multiple) ---------- */
    } else if (event === "getOptionalInfo") {
      const { activity } = req.body as any;
      const data = await getOptionalInfoH(activity); // array | null
      res.json({ success: true, data: data ?? [] });
      return;
    } else if (event === "upsertOptionalInfo") {
      const { activity, label } = req.body as any;
      const date = (req.body as any).date ?? null; // optional
      if (!activity || !label) {
        res.status(400).json({ success: false, msg: "activity and label are required" }); return;
      }
      const r = await upsertOptionalInfoH(activity, label, date);
      if (!r.ok) { res.status(404).json({ success: false, msg: "streak not found" }); return; }
      res.status(201).json({ success: true, data: r.item }); return;
    } else if (event === "clearOptionalInfo") {
      const { activity, id } = req.body as any; // id optional → clear all
      if (!activity) { res.status(400).json({ success: false, msg: "activity required" }); return; }
      const ok = await clearOptionalInfoH(activity, id);
      if (!ok) { /* ignore */ }
    } else {
      res.status(400).json({ success: false, msg: "Unknown event" }); return;
    }

    res.status(201).json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
}

/* REST-style DELETE (unchanged) */
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
