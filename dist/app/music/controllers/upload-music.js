// app/music/controllers/upload-music.ts
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { demucsQueue } from "../queues/demucs.queue.js";
const router = express.Router();
const ALL_STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"];
/* timeouts */
const TEN_MIN = 10 * 60 * 1000;
function longTimeout(_req, res, next) {
    res.setTimeout(TEN_MIN);
    next();
}
/* filesystem */
const ROOT = process.cwd();
const SEPARATED_DIR = path.join(ROOT, "separated");
const UPLOADS_DIR = path.join(ROOT, "uploads");
for (const d of [SEPARATED_DIR, UPLOADS_DIR]) {
    fs.mkdirSync(d, { mode: 0o770, recursive: true });
}
// Model name - should match worker
const model = process.env.DEMUCS_MODEL || "htdemucs_6s";
/* static */
router.use("/separated", express.static(SEPARATED_DIR, {
    maxAge: "1h",
    etag: true,
    lastModified: true,
}));
/* upload */
const upload = multer({
    dest: UPLOADS_DIR,
    fileFilter: (_req, file, cb) => file.mimetype.startsWith("audio/")
        ? cb(null, true)
        : cb(new Error("Only audio files allowed")),
});
/* optional Redis ledger */
let Redis = null;
try {
    const { BullRedis } = require("../../lib/bullRedis.ts");
    Redis = BullRedis;
}
catch { }
// Changed to 15 days as requested
const FIFTEEN_DAYS_SEC = 60 * 60 * 24 * 15;
const FIFTEEN_DAYS_MS = 1000 * 60 * 60 * 24 * 15;
const META_TTL_SEC = FIFTEEN_DAYS_SEC;
const key = (id) => `stems:${id}:meta`;
async function ledgerSet(id, obj) {
    if (!Redis)
        return;
    await Redis.hset(key(id), Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)])));
    await Redis.expire(key(id), META_TTL_SEC);
}
async function ledgerGet(id) {
    if (!Redis)
        return {};
    try {
        return await Redis.hgetall(key(id));
    }
    catch {
        return {};
    }
}
/* helpers */
function absUrl(req, maybePath) {
    if (!maybePath)
        return;
    if (/^https?:\/\//i.test(maybePath))
        return maybePath;
    const xfProto = req.headers["x-forwarded-proto"]?.split(",")[0];
    const proto = xfProto?.trim() || req.protocol || "https";
    const host = req.get("host") || "localhost:3000";
    const p = maybePath.startsWith("/") ? maybePath : `/${maybePath}`;
    return `${proto}://${host}/music${p}`;
}
function findStemFiles(dir) {
    try {
        const files = fs.readdirSync(dir);
        const pick = (stemName) => files
            .filter((f) => f.toLowerCase().startsWith(`${stemName.toLowerCase()}.`))
            .sort((a, b) => {
            const pref = [".m4a", ".mp3", ".wav", ".aac", ".caf"];
            return (pref.indexOf(path.extname(a).toLowerCase()) -
                pref.indexOf(path.extname(b).toLowerCase()));
        })[0];
        // Return all 6 stems
        const result = {};
        for (const stem of ALL_STEMS) {
            result[stem] = pick(stem);
        }
        return result;
    }
    catch {
        return {};
    }
}
function sepDirFromAnyUrl(url) {
    if (!url)
        return;
    try {
        const pathname = url.startsWith("http") ? new URL(url).pathname : url;
        const parts = pathname.split("/").filter(Boolean);
        const sepIdx = parts.indexOf("separated");
        if (sepIdx === -1 || parts.length < sepIdx + 3)
            return;
        const folder = parts.slice(sepIdx + 1, -1).join("/");
        return path.join(SEPARATED_DIR, folder);
    }
    catch {
        return;
    }
}
function sepDirFromBasename(b) {
    if (!b)
        return;
    // Check with model prefix first
    const withModel = path.join(SEPARATED_DIR, model, b);
    if (fs.existsSync(withModel) && fs.statSync(withModel).isDirectory())
        return withModel;
    const direct = path.join(SEPARATED_DIR, b);
    if (fs.existsSync(direct) && fs.statSync(direct).isDirectory())
        return direct;
    try {
        for (const ent of fs.readdirSync(SEPARATED_DIR, { withFileTypes: true })) {
            if (!ent.isDirectory())
                continue;
            const cand = path.join(SEPARATED_DIR, ent.name, b);
            if (fs.existsSync(cand) && fs.statSync(cand).isDirectory())
                return cand;
        }
    }
    catch { }
    return;
}
function urlsFromSepDir(req, sepDir) {
    if (!sepDir)
        return {};
    const stemFiles = findStemFiles(sepDir);
    const rel = path.relative(SEPARATED_DIR, sepDir).replace(/\\/g, "/");
    const result = {};
    // Build URLs for all 6 stems
    for (const stem of ALL_STEMS) {
        const file = stemFiles[stem];
        if (file) {
            result[`${stem}Url`] = absUrl(req, `/separated/${rel}/${file}`);
        }
    }
    // Legacy compatibility
    result.accompanimentUrl = result.otherUrl;
    result.instrumentalUrl = result.otherUrl;
    return result;
}
async function resolveSepDir(job, ret) {
    let dir = ret?.sepDir ||
        sepDirFromAnyUrl(ret?.vocalsUrl) ||
        sepDirFromAnyUrl(ret?.drumsUrl) ||
        sepDirFromAnyUrl(ret?.otherUrl);
    if (dir)
        return dir;
    const candidates = Array.from(new Set([job?.id, job?.data?.basename, job?.data?.originalBasename].filter(Boolean)));
    for (const b of candidates) {
        const d = sepDirFromBasename(b);
        if (d)
            return d;
    }
    return;
}
async function gather(req, idOrJob) {
    const job = typeof idOrJob === "string" ? await demucsQueue.getJob(idOrJob) : idOrJob;
    let state = "not_found";
    let progress = 0;
    if (job) {
        state = await job.getState();
        progress = job.progress || 0;
    }
    const ret = job?.returnvalue || {};
    const sepDir = (await resolveSepDir(job, ret)) ||
        sepDirFromBasename(typeof idOrJob === "string" ? idOrJob : undefined);
    const urls = urlsFromSepDir(req, sepDir);
    // Get all stem URLs
    const vocalsUrl = urls.vocalsUrl || absUrl(req, ret.vocalsUrl);
    const drumsUrl = urls.drumsUrl || absUrl(req, ret.drumsUrl);
    const bassUrl = urls.bassUrl || absUrl(req, ret.bassUrl);
    const guitarUrl = urls.guitarUrl || absUrl(req, ret.guitarUrl);
    const pianoUrl = urls.pianoUrl || absUrl(req, ret.pianoUrl);
    const otherUrl = urls.otherUrl || absUrl(req, ret.otherUrl);
    // Ready if we have at least vocals (primary stem)
    const ready = !!vocalsUrl;
    return {
        state: ready ? "completed" : state,
        progress: ready ? 100 : progress,
        ready,
        result: {
            vocalsUrl,
            drumsUrl,
            bassUrl,
            guitarUrl,
            pianoUrl,
            otherUrl,
            // Legacy compatibility
            accompanimentUrl: otherUrl,
            instrumentalUrl: otherUrl,
            sepDir,
        },
    };
}
/* Sweeper - Changed to 15 days */
setInterval(() => {
    console.log("[sweeper] Running cleanup for files older than 15 days...");
    try {
        const sweep = (dir) => {
            if (!fs.existsSync(dir))
                return;
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, ent.name);
                try {
                    const st = fs.statSync(p);
                    const old = Date.now() - st.mtimeMs > FIFTEEN_DAYS_MS;
                    if (ent.isDirectory()) {
                        old ? fs.rmSync(p, { recursive: true, force: true }) : sweep(p);
                    }
                    else if (old)
                        fs.rmSync(p, { force: true });
                }
                catch { }
            }
        };
        sweep(SEPARATED_DIR);
        sweep(UPLOADS_DIR);
    }
    catch { }
}, 60 * 60 * 1000); // Run every hour
/* ========== ROUTES ========== */
router.post("/upload", longTimeout, upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res
                .status(400)
                .json({ success: false, message: "Field 'file' is required." });
            return;
        }
        const songId = req.body?.songId?.trim();
        const basename = songId || file.filename;
        // Check if job already exists
        const existingJob = await demucsQueue.getJob(basename);
        if (existingJob) {
            const state = await existingJob.getState();
            if (state === "completed" || state === "active" || state === "waiting") {
                // Job exists, return current state
                const meta = await ledgerGet(basename);
                res.json({
                    success: true,
                    jobId: existingJob.id,
                    alreadyExists: true,
                    state,
                    progress: Number(meta.progress || 0),
                });
                return;
            }
        }
        const job = await demucsQueue.add("separate", {
            inputPath: file.path,
            basename,
            originalBasename: file.filename,
            originalName: file.originalname,
            uploadedAt: Date.now(),
        }, songId ? { jobId: basename } : undefined);
        const now = Date.now();
        await ledgerSet(basename, {
            status: "enqueued",
            available: 0,
            uploadedAt: now,
            progress: 5, // Start at 5% to show immediate feedback
            expiresAt: now + FIFTEEN_DAYS_MS,
            originalName: file.originalname,
            size: file.size,
        });
        console.log(`[upload] Job created: ${job.id} for song ${basename}`);
        res.json({
            success: true,
            jobId: job.id,
            originalName: file.originalname,
            size: file.size,
            progress: 5,
        });
    }
    catch (e) {
        console.error("[upload] error:", e);
        res.status(500).json({ success: false });
    }
});
router.get("/stems/:id/state", async (req, res) => {
    try {
        const id = req.params.id;
        const info = await gather(req, id);
        const meta = await ledgerGet(id);
        let available = info.ready;
        let expiresAt = null;
        let displayProgress = info.progress;
        // Get milestone-based progress for smooth UI
        if (meta && Object.keys(meta).length) {
            const stillValid = !meta.expiresAt || Date.now() < Number(meta.expiresAt);
            available = meta.available === "1" && stillValid;
            expiresAt = meta.expiresAt ? Number(meta.expiresAt) : null;
            // Use stored progress if higher (for smooth milestone progression)
            const storedProgress = Number(meta.progress || 0);
            displayProgress = Math.max(displayProgress, storedProgress);
        }
        // Map job states to milestone progress for smoother UX
        const stateMilestones = {
            waiting: 10,
            active: 25,
            delayed: 15,
        };
        if (!info.ready && stateMilestones[info.state]) {
            displayProgress = Math.max(displayProgress, stateMilestones[info.state]);
        }
        if (info.ready && !available) {
            const now = Date.now();
            const r = (info.result || {});
            expiresAt = now + FIFTEEN_DAYS_MS;
            await ledgerSet(id, {
                status: "completed",
                progress: 100,
                available: 1,
                readyAt: now,
                expiresAt,
                vocalsUrl: r.vocalsUrl || "",
                drumsUrl: r.drumsUrl || "",
                bassUrl: r.bassUrl || "",
                guitarUrl: r.guitarUrl || "",
                pianoUrl: r.pianoUrl || "",
                otherUrl: r.otherUrl || "",
                accompanimentUrl: r.otherUrl || "",
                instrumentalUrl: r.otherUrl || "",
            });
            available = true;
            displayProgress = 100;
        }
        else {
            // Update ledger with current progress
            await ledgerSet(id, {
                status: info.ready ? "completed" : info.state || "pending",
                progress: displayProgress,
                available: available ? 1 : 0,
            });
        }
        res.json({
            state: info.state,
            progress: displayProgress,
            ready: !!info.ready,
            available,
            expiresAt,
        });
    }
    catch (e) {
        console.error("[stems state] error:", e);
        res
            .status(500)
            .json({ state: "error", progress: 0, ready: false, available: false });
    }
});
router.get("/stems/:id/result", async (req, res) => {
    try {
        const id = req.params.id;
        const info = await gather(req, id);
        const meta = await ledgerGet(id);
        const isAvailable = meta?.available === "1" &&
            (!meta.expiresAt || Date.now() < Number(meta.expiresAt));
        if (info.ready && isAvailable) {
            res.json({
                ready: true,
                available: true,
                expiresAt: meta?.expiresAt ? Number(meta.expiresAt) : null,
                // All 6 stems
                vocalsUrl: info.result.vocalsUrl,
                drumsUrl: info.result.drumsUrl,
                bassUrl: info.result.bassUrl,
                guitarUrl: info.result.guitarUrl,
                pianoUrl: info.result.pianoUrl,
                otherUrl: info.result.otherUrl,
                // Legacy
                accompanimentUrl: info.result.otherUrl,
                instrumentalUrl: info.result.otherUrl,
            });
            return;
        }
        if (info.ready && !isAvailable) {
            const now = Date.now();
            const urls = (info.result || {});
            await ledgerSet(id, {
                available: 1,
                readyAt: now,
                expiresAt: now + FIFTEEN_DAYS_MS,
                vocalsUrl: urls.vocalsUrl || "",
                drumsUrl: urls.drumsUrl || "",
                bassUrl: urls.bassUrl || "",
                guitarUrl: urls.guitarUrl || "",
                pianoUrl: urls.pianoUrl || "",
                otherUrl: urls.otherUrl || "",
                accompanimentUrl: urls.otherUrl || "",
                instrumentalUrl: urls.otherUrl || "",
                status: "completed",
                progress: 100,
            });
            res.json({
                ready: true,
                available: true,
                expiresAt: now + FIFTEEN_DAYS_MS,
                vocalsUrl: urls.vocalsUrl,
                drumsUrl: urls.drumsUrl,
                bassUrl: urls.bassUrl,
                guitarUrl: urls.guitarUrl,
                pianoUrl: urls.pianoUrl,
                otherUrl: urls.otherUrl,
                accompanimentUrl: urls.otherUrl,
                instrumentalUrl: urls.otherUrl,
            });
            return;
        }
        res.json({
            ready: false,
            available: false,
            expiresAt: meta?.expiresAt ? Number(meta.expiresAt) : null,
            progress: Number(meta?.progress || 0),
        });
    }
    catch (e) {
        console.error("[stems result] error:", e);
        res.status(500).json({ ready: false, available: false });
    }
});
router.post("/stems/:id/cleanup", async (req, res) => {
    try {
        const id = req.params.id;
        const job = await demucsQueue.getJob(id);
        const removeFiles = (sepDir, uploadPath) => {
            if (sepDir) {
                try {
                    fs.rmSync(sepDir, { recursive: true, force: true });
                }
                catch { }
            }
            if (uploadPath && fs.existsSync(uploadPath)) {
                try {
                    fs.rmSync(uploadPath, { force: true });
                }
                catch { }
            }
        };
        if (job) {
            const state = await job.getState();
            if (state !== "completed") {
                res.status(409).json({ success: false, message: "not_completed" });
                return;
            }
            const ret = job.returnvalue || {};
            const sepDir = await resolveSepDir(job, ret);
            const uploadPath = job.data?.inputPath;
            removeFiles(sepDir, uploadPath);
            try {
                await job.remove();
            }
            catch { }
        }
        else {
            const sepDir = sepDirFromBasename(id);
            const uploadPath = path.join(UPLOADS_DIR, id);
            removeFiles(sepDir, uploadPath);
        }
        const now = Date.now();
        await ledgerSet(id, {
            status: "cleaned",
            available: 0,
            downloadedAt: now,
            cleanedUpAt: now,
            progress: 0,
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error("[stems cleanup] error:", e);
        res.status(500).json({ success: false });
    }
});
export default router;
