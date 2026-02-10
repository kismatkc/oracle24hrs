// app/music/controllers/upload-music.ts
// Oracle backend - handles uploads and stem extraction via BullMQ queue

import express, { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { demucsQueue } from "../queues/demucs.queue.ts";

const router = express.Router();

const ROOT = process.cwd();
const SEPARATED_DIR = path.join(ROOT, "separated");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const NORMALIZED_DIR = path.join(ROOT, "normalized");
for (const d of [SEPARATED_DIR, UPLOADS_DIR, NORMALIZED_DIR]) {
  fs.mkdirSync(d, { mode: 0o770, recursive: true });
}

const model = process.env.DEMUCS_MODEL || "htdemucs_6s";

// Static serving for separated stems
router.use("/separated", express.static(SEPARATED_DIR, { maxAge: "1h" }));

const upload = multer({
  dest: UPLOADS_DIR,
  fileFilter: (_req, file, cb) =>
    file.mimetype.startsWith("audio/")
      ? cb(null, true)
      : cb(new Error("Only audio files")),
});

// Redis ledger for tracking job state
let Redis: any = null;
try {
  const { BullRedis } = require("../../../lib/bullRedis.ts");
  Redis = BullRedis;
} catch {}

const THREE_DAYS_SEC = 60 * 60 * 24 * 3;
const THREE_DAYS_MS = THREE_DAYS_SEC * 1000;
const key = (id: string) => `stems:${id}:meta`;

async function ledgerSet(
  id: string,
  obj: Record<string, string | number | boolean>
): Promise<void> {
  if (!Redis) return;
  await Redis.hset(
    key(id),
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]))
  );
  await Redis.expire(key(id), THREE_DAYS_SEC);
}

async function ledgerGet(id: string): Promise<Record<string, string>> {
  if (!Redis) return {};
  try {
    return await Redis.hgetall(key(id));
  } catch {
    return {};
  }
}

function absUrl(req: Request, maybePath?: string): string | undefined {
  if (!maybePath) return;
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  const proto =
    (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() ||
    req.protocol ||
    "https";
  const host = req.get("host") || "localhost:3000";
  return `${proto}://${host}/music${
    maybePath.startsWith("/") ? maybePath : `/${maybePath}`
  }`;
}

function findStemFiles(dir: string): Record<string, string | undefined> {
  try {
    const files = fs.readdirSync(dir);
    const pick = (stem: string) =>
      files.find((f) => f.toLowerCase().startsWith(`${stem}.`));
    return {
      vocals: pick("vocals"),
      drums: pick("drums"),
      bass: pick("bass"),
      guitar: pick("guitar"),
      piano: pick("piano"),
      other: pick("other"),
      instrumental: pick("instrumental"),
    };
  } catch {
    return {};
  }
}

function sepDirFromBasename(b?: string): string | undefined {
  if (!b) return;
  for (const suffix of ["_normalized", ""]) {
    const dir = path.join(SEPARATED_DIR, model, `${b}${suffix}`);
    if (fs.existsSync(dir)) return dir;
  }
  return;
}

function urlsFromSepDir(
  req: Request,
  sepDir?: string
): Record<string, string | undefined> {
  if (!sepDir) return {};
  const files = findStemFiles(sepDir);
  const rel = path.relative(SEPARATED_DIR, sepDir).replace(/\\/g, "/");
  const result: Record<string, string | undefined> = {};
  for (const [stem, file] of Object.entries(files)) {
    if (file) result[`${stem}Url`] = absUrl(req, `/separated/${rel}/${file}`);
  }
  result.accompanimentUrl = result.instrumentalUrl || result.otherUrl;
  return result;
}

async function gather(
  req: Request,
  id: string
): Promise<{
  state: string;
  progress: number;
  ready: boolean;
  result: Record<string, string | undefined>;
}> {
  const job = await demucsQueue.getJob(id);
  let state = "not_found",
    progress = 0;
  if (job) {
    state = await job.getState();
    progress = (job.progress as number) || 0;
  }

  const ret = job?.returnvalue || {};
  const sepDir = ret.sepDir || sepDirFromBasename(id);
  const urls = urlsFromSepDir(req, sepDir);
  const ready = !!urls.vocalsUrl;

  return {
    state: ready ? "completed" : state,
    progress: ready ? 100 : progress,
    ready,
    result: { ...urls, sepDir },
  };
}

// 72-hour purge sweeper
setInterval(() => {
  const sweep = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      try {
        const old = Date.now() - fs.statSync(p).mtimeMs > THREE_DAYS_MS;
        if (ent.isDirectory())
          old ? fs.rmSync(p, { recursive: true }) : sweep(p);
        else if (old) fs.rmSync(p);
      } catch {}
    }
  };
  sweep(SEPARATED_DIR);
  sweep(UPLOADS_DIR);
  sweep(NORMALIZED_DIR);
}, 60 * 60 * 1000);

/* ========== ROUTES ========== */

// Upload and queue for Oracle processing
router.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = (req as any).file;
      if (!file) {
        res.status(400).json({ success: false, message: "File required" });
        return;
      }

      const songId = (req.body?.songId as string)?.trim();
      const basename = songId || file.filename;

      // Check existing job
      const existing = await demucsQueue.getJob(basename);
      if (existing) {
        const state = await existing.getState();

        // For completed jobs, verify stem files still exist on disk
        // (72-hour cleanup may have purged them)
        if (state === "completed") {
          const sepDir =
            existing.returnvalue?.sepDir || sepDirFromBasename(basename);
          const stemFiles = sepDir ? findStemFiles(sepDir) : {};
          const filesExist = !!stemFiles.vocals;

          if (filesExist) {
            // Stems still on disk — safe to return alreadyExists
            res.json({
              success: true,
              jobId: existing.id,
              alreadyExists: true,
              state,
            });
            return;
          }

          // Stale job: BullMQ says "completed" but files are purged
          // Remove the stale job so we can create a fresh one below
          console.log(
            `[upload] Stale completed job ${basename} — stem files purged, re-queuing`
          );
          try {
            await existing.remove();
          } catch {}
          // Fall through to create a new job
        } else if (["active", "waiting"].includes(state)) {
          res.json({
            success: true,
            jobId: existing.id,
            alreadyExists: true,
            state,
          });
          return;
        }
      }

      const job = await demucsQueue.add(
        "separate",
        { inputPath: file.path, basename },
        songId ? { jobId: basename } : undefined
      );
      await ledgerSet(basename, {
        status: "enqueued",
        progress: 5,
        uploadedAt: Date.now(),
        expiresAt: Date.now() + THREE_DAYS_MS,
      });

      console.log(`[upload] Job created: ${job.id}`);
      res.json({
        success: true,
        jobId: job.id,
        originalName: file.originalname,
        size: file.size,
        progress: 5,
      });
    } catch (e) {
      console.error("[upload] error:", e);
      res.status(500).json({ success: false });
    }
  }
);

// Get job state
router.get(
  "/stems/:id/state",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id;
      const info = await gather(req, id);
      const meta = await ledgerGet(id);

      let available = info.ready;
      let expiresAt: number | null = meta.expiresAt
        ? Number(meta.expiresAt)
        : null;

      if (info.ready && meta.available !== "1") {
        expiresAt = Date.now() + THREE_DAYS_MS;
        await ledgerSet(id, {
          status: "completed",
          progress: 100,
          available: 1,
          expiresAt,
          ...info.result,
        });
        available = true;
      }

      res.json({
        state: info.state,
        progress: info.progress,
        ready: info.ready,
        available,
        expiresAt,
      });
    } catch (e) {
      console.error("[stems state] error:", e);
      res
        .status(500)
        .json({ state: "error", progress: 0, ready: false, available: false });
    }
  }
);

// Get stem URLs
router.get(
  "/stems/:id/result",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id;
      const info = await gather(req, id);
      const meta = await ledgerGet(id);

      if (info.ready) {
        const expiresAt = meta.expiresAt
          ? Number(meta.expiresAt)
          : Date.now() + THREE_DAYS_MS;
        if (meta.available !== "1") {
          await ledgerSet(id, {
            status: "completed",
            progress: 100,
            available: 1,
            expiresAt,
            ...info.result,
          });
        }
        res.json({ ready: true, available: true, expiresAt, ...info.result });
        return;
      }

      res.json({ ready: false, available: false, progress: info.progress });
    } catch (e) {
      console.error("[stems result] error:", e);
      res.status(500).json({ ready: false, available: false });
    }
  }
);

// Cleanup after download
router.post(
  "/stems/:id/cleanup",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id;
      const job = await demucsQueue.getJob(id);

      if (job) {
        const state = await job.getState();
        if (state !== "completed") {
          res.status(409).json({ success: false, message: "not_completed" });
          return;
        }

        const sepDir = job.returnvalue?.sepDir || sepDirFromBasename(id);
        if (sepDir)
          try {
            fs.rmSync(sepDir, { recursive: true });
          } catch {}
        try {
          await job.remove();
        } catch {}
      } else {
        const sepDir = sepDirFromBasename(id);
        if (sepDir)
          try {
            fs.rmSync(sepDir, { recursive: true });
          } catch {}
      }

      await ledgerSet(id, {
        status: "cleaned",
        available: 0,
        cleanedUpAt: Date.now(),
      });
      res.json({ success: true });
    } catch (e) {
      console.error("[stems cleanup] error:", e);
      res.status(500).json({ success: false });
    }
  }
);

// Combined check+prepare: returns state AND URLs in a single call (#4)
// Replaces the need for separate /state + /result round trips
router.get(
  "/stems/:id/check",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id;
      const info = await gather(req, id);
      const meta = await ledgerGet(id);

      let available = info.ready;
      let expiresAt: number | null = meta.expiresAt
        ? Number(meta.expiresAt)
        : null;

      if (info.ready && meta.available !== "1") {
        expiresAt = Date.now() + THREE_DAYS_MS;
        await ledgerSet(id, {
          status: "completed",
          progress: 100,
          available: 1,
          expiresAt,
          ...info.result,
        });
        available = true;
      }

      // Return everything the client needs in one shot
      const response: Record<string, any> = {
        state: info.state,
        progress: info.progress,
        ready: info.ready,
        available,
        expiresAt,
      };

      // Include stem URLs when ready (so client doesn't need a second /result call)
      if (info.ready) {
        const { sepDir, ...urls } = info.result;
        Object.assign(response, urls);
      }

      res.json(response);
    } catch (e) {
      console.error("[stems check] error:", e);
      res
        .status(500)
        .json({ state: "error", progress: 0, ready: false, available: false });
    }
  }
);

export default router;
