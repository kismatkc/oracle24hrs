import express, { type Request, type Response } from "express";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const router = express.Router();

const DATA_ROOT = path.join(process.cwd(), "app", "data", "morning-knowledge");
const LIVE_ROOT = path.join(DATA_ROOT, "live");
const LIVE_PACKS_ROOT = path.join(LIVE_ROOT, "packs");
const LIVE_MANIFEST_PATH = path.join(LIVE_ROOT, "manifest.json");
const SYNCED_SESSIONS_ROOT = path.join(DATA_ROOT, "synced-sessions");
const DEFAULT_WARNING_THRESHOLD = 4;

interface LiveManifest {
  batchId: string;
  createdAt: string;
  warningThreshold: number;
  dateKeys: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidSessionId(value: string): boolean {
  return /^[A-Za-z0-9._-]{8,}$/.test(value);
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeManifest(raw: unknown): LiveManifest {
  if (!isPlainObject(raw)) {
    return {
      batchId: "",
      createdAt: "",
      warningThreshold: DEFAULT_WARNING_THRESHOLD,
      dateKeys: [],
    };
  }

  const dateKeys = Array.isArray(raw.dateKeys)
    ? raw.dateKeys.filter((value): value is string => typeof value === "string" && isValidDateKey(value)).sort()
    : [];

  return {
    batchId: typeof raw.batchId === "string" ? raw.batchId : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    warningThreshold:
      typeof raw.warningThreshold === "number" && Number.isFinite(raw.warningThreshold)
        ? raw.warningThreshold
        : DEFAULT_WARNING_THRESHOLD,
    dateKeys,
  };
}

async function readLiveManifest(): Promise<LiveManifest> {
  const raw = await readJsonIfExists<unknown>(LIVE_MANIFEST_PATH);
  return normalizeManifest(raw);
}

function validatePack(raw: unknown, dateKey: string) {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.batchId !== "string") return null;
  if (typeof raw.dateKey !== "string" || raw.dateKey !== dateKey) return null;
  if (!Array.isArray(raw.questions) || raw.questions.length !== 30) return null;
  return {
    ...raw,
    totalQuestions:
      typeof raw.totalQuestions === "number" && Number.isFinite(raw.totalQuestions)
        ? raw.totalQuestions
        : raw.questions.length,
  };
}

async function readLivePack(dateKey: string) {
  const raw = await readJsonIfExists<unknown>(path.join(LIVE_PACKS_ROOT, `${dateKey}.json`));
  return validatePack(raw, dateKey);
}

function buildAvailability(manifest: LiveManifest, dateKey: string, hasPack: boolean) {
  const futurePackCount = manifest.dateKeys.filter((value) => value >= dateKey).length;
  const warningThreshold = manifest.warningThreshold || DEFAULT_WARNING_THRESHOLD;
  return {
    dateKey,
    hasPack,
    futurePackCount,
    needsRefill: futurePackCount < warningThreshold,
    batchId: manifest.batchId || undefined,
    warningThreshold,
  };
}

router.get("/morning-knowledge/pack", async (req: Request, res: Response) => {
  const dateKey = typeof req.query.date === "string" ? req.query.date : "";
  if (!isValidDateKey(dateKey)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }

  const manifest = await readLiveManifest();
  const pack = await readLivePack(dateKey);
  const availability = buildAvailability(manifest, dateKey, Boolean(pack));

  if (!pack) {
    res.status(404).json({
      error: "Morning knowledge pack not found",
      meta: availability,
    });
    return;
  }

  res.json({
    pack,
    meta: availability,
  });
});

router.get("/morning-knowledge/availability", async (req: Request, res: Response) => {
  const dateKey = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
  if (!isValidDateKey(dateKey)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }

  const manifest = await readLiveManifest();
  const pack = await readLivePack(dateKey);
  res.json(buildAvailability(manifest, dateKey, Boolean(pack)));
});

router.post("/morning-knowledge/sessions", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const sessionDateKey = typeof body.sessionDateKey === "string" ? body.sessionDateKey : "";
  const completedAt = typeof body.completedAt === "string" ? body.completedAt : "";
  const attempts = Array.isArray(body.attempts) ? body.attempts : null;

  if (!isValidSessionId(sessionId)) {
    res.status(400).json({ error: "sessionId is invalid" });
    return;
  }
  if (!isValidDateKey(sessionDateKey)) {
    res.status(400).json({ error: "sessionDateKey must be YYYY-MM-DD" });
    return;
  }
  if (!completedAt || !attempts) {
    res.status(400).json({ error: "completedAt and attempts are required" });
    return;
  }

  const targetDir = path.join(SYNCED_SESSIONS_ROOT, sessionDateKey);
  await fs.mkdir(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, `${sessionId}.json`);

  const payload = {
    ...body,
    storedAt: new Date().toISOString(),
  };

  try {
    await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    res.status(201).json({ ok: true, stored: true, sessionId });
    return;
  } catch (error: any) {
    if (error?.code === "EEXIST") {
      res.json({ ok: true, existing: true, sessionId });
      return;
    }
    throw error;
  }
});

export default router;
