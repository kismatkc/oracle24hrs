// import express, { NextFunction, Request, Response } from "express";
// import multer from "multer";
// import path from "path";
// import fs from "fs";
// import { demucsQueue } from "../queues/demucs.queue.js";
// // import { spawn } from "child_process";                    // (old) not needed once we enqueue
// const router = express.Router();
// const TEN_MIN = 10 * 60 * 1000; // 10 minutes in ms
// function longTimeout(_req: Request, res: Response, next: NextFunction) {
//   res.setTimeout(TEN_MIN);
//   next();
// }
// const SEPARATED_DIR = path.join(process.cwd(), "separated");
// const UPLOADS_DIR = path.join(process.cwd(), "uploads");
// fs.mkdirSync(SEPARATED_DIR, { recursive: true });
// fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// router.use(
//   "/separated",
//   express.static(SEPARATED_DIR, {
//     maxAge: "1h",
//     etag: true,
//     lastModified: true,
//   })
// );
// const upload = multer({
//   dest: UPLOADS_DIR,
//   fileFilter: (_req, file, cb) => {
//     if (!file.mimetype.startsWith("audio/")) {
//        cb(new Error("Only audio files allowed"));
//     }
//     cb(null, true);
//   },
// });
// /**
//  * POST /upload_music
//  * - Uploads file to disk (multer).
//  * - ENQUEUES a Demucs job and returns jobId (non-blocking).
//  */
// router.post(
//   "/upload_music",
//   longTimeout,
//   // (Removed the global purge call to avoid breaking concurrent jobs)   // [ADD] Explain: keep stems of others
//   upload.single("file"),
//   async (req: Request, res: Response) => {
//     try {
//       const file = (req as any).file as
//         | { originalname: string; size: number; filename: string; path: string }
//         | undefined;
//       console.log(
//         "[upload_music] received file:",
//         file?.originalname,
//         file?.size
//       );
//       if (!file) {
//         res.status(400).json({
//           success: false,
//           message: "No music file received. Field name must be 'file'.",
//         });
//       }
//       const basename = file.filename; // [ADD] Unique dir Demucs uses for output
//       const job = await demucsQueue.add("separate", {
//         // [ADD] Push job to BullMQ
//         inputPath: file.path, // [ADD] Path of uploaded file
//         basename, // [ADD] Used to build stem URLs
//       });
//       res.status(200).json({
//         // [ADD] Non-blocking response
//         success: true,
//         jobId: job.id, // [ADD] Client will poll with this
//         originalName: file.originalname,
//         size: file.size,
//       });
//     } catch (err) {
//       console.error("[upload_music] enqueue error:", err);
//       res.status(500).json({ success: false });
//     }
//   }
// );
// /**
//  * GET /job/:id/status
//  * - Polling endpoint for progress and final result.
//  */
// router.get("/job/:id/status", async (req: Request, res: Response) => {
//   // [ADD] New endpoint
//   try {
//     const job = await demucsQueue.getJob(req.params.id); // [ADD] Load job by id
//     if (!job) res.status(404).json({ state: "not_found" }); // [ADD] Unknown id
//     const state = await job.getState(); // [ADD] waiting | active | completed | failed
//     const progress = (job.progress as number) || 0; // [ADD] 0..100 from worker
//     if (state === "completed") {
//       // [ADD] Include result when done
//       res.json({ state, progress, result: job.returnvalue });
//     }
//     if (state === "failed") {
//       res.json({ state, progress, failedReason: job.failedReason });
//     }
//     res.json({ state, progress }); // [ADD] Running states
//   } catch (e) {
//     console.error("[job status] error:", e);
//     res.status(500).json({ state: "error" });
//   }
// });
// export default router;
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { demucsQueue } from "../queues/demucs.queue.js";
const router = express.Router();
const TEN_MIN = 10 * 60 * 1000; // 10 minutes in ms
function longTimeout(_req, res, next) {
    res.setTimeout(TEN_MIN);
    next();
}
const SEPARATED_DIR = path.join(process.cwd(), "separated");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
fs.mkdirSync(SEPARATED_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
router.use("/separated", express.static(SEPARATED_DIR, {
    maxAge: "1h",
    etag: true,
    lastModified: true,
}));
const upload = multer({
    dest: UPLOADS_DIR,
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith("audio/")) {
            cb(new Error("Only audio files allowed"));
        }
        cb(null, true);
    },
});
/**
 * POST /upload_music
 * Uploads file, enqueues job, returns jobId.
 */
router.post("/upload_music", longTimeout, upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        console.log("[upload_music] received file:", file?.originalname, file?.size);
        if (!file) {
            res.status(400).json({
                success: false,
                message: "No music file received. Field name must be 'file'.",
            });
        }
        const basename = file.filename;
        const job = await demucsQueue.add("separate", {
            inputPath: file.path,
            basename,
        });
        res.status(200).json({
            success: true,
            jobId: job.id,
            originalName: file.originalname,
            size: file.size,
        });
    }
    catch (err) {
        console.error("[upload_music] enqueue error:", err);
        res.status(500).json({ success: false });
    }
});
/**
 * GET /job/:id/status
 * Polling endpoint for progress and final result.
 */
router.get("/job/:id/status", async (req, res) => {
    try {
        const job = await demucsQueue.getJob(req.params.id);
        if (!job)
            res.status(404).json({ state: "not_found" });
        const state = await job.getState(); // waiting | active | completed | failed
        const progress = job.progress || 0;
        if (state === "completed") {
            res.json({ state, progress, result: job.returnvalue });
        }
        if (state === "failed") {
            res.json({ state, progress, failedReason: job.failedReason });
        }
        res.json({ state, progress });
    }
    catch (e) {
        console.error("[job status] error:", e);
        res.status(500).json({ state: "error" });
    }
});
/**
 * POST /job/:id/cleanup
 * Client calls this immediately after caching the files.
 * Deletes the separated folder and (if still present) the original upload file.
 */
router.post("/job/:id/cleanup", async (req, res) => {
    try {
        const job = await demucsQueue.getJob(req.params.id);
        if (!job)
            res.status(404).json({ success: false, message: "not_found" });
        const state = await job.getState();
        if (state !== "completed") {
            res.status(409).json({ success: false, message: "not_completed" });
        }
        const ret = job.returnvalue;
        // delete separated dir immediately
        if (ret?.sepDir) {
            try {
                fs.rmSync(ret.sepDir, { recursive: true, force: true });
            }
            catch (e) {
                console.warn("[cleanup] failed to remove sepDir:", e);
            }
        }
        // In case the upload file still exists for any reason, try to remove by basename
        // (Demucs worker already unlinks, so this is just a best-effort fallback)
        try {
            const basename = (ret?.vocalsUrl || "").split("/").at(-2); // mdx_q/<basename>/vocals.wav
            if (basename) {
                const maybeUploadPath = path.join(UPLOADS_DIR, basename);
                if (fs.existsSync(maybeUploadPath)) {
                    fs.rmSync(maybeUploadPath, { recursive: true, force: true });
                }
            }
        }
        catch { }
        // Optionally: remove job immediately from Redis metadata
        try {
            await job.remove();
        }
        catch { }
        res.json({ success: true });
    }
    catch (e) {
        console.error("[job cleanup] error:", e);
        res.status(500).json({ success: false });
    }
});
export default router;
