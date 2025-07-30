// src/server/routes/test-upload-music.ts
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
const router = express.Router();
// ──────────────────────────────────────────────
// Ensure folders exist
const SEPARATED_DIR = path.join(process.cwd(), "separated");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
fs.mkdirSync(SEPARATED_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// Serve stems statically at /separated/*
router.use("/separated", express.static(SEPARATED_DIR, {
    maxAge: "1h",
    etag: true,
    lastModified: true,
}));
// Multer: write uploads to disk
const upload = multer({
    dest: UPLOADS_DIR,
    // limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith("audio/")) {
            return cb(new Error("Only audio files allowed"));
        }
        cb(null, true);
    },
});
// Run Demucs (CLI) and resolve URLs
function runDemucs(inputPath, basename) {
    return new Promise((resolve, reject) => {
        const model = "mdx_q";
        // Point to venv bin dir (adjust if yours is elsewhere)
        const VENV_BIN = path.join(process.env.HOME || "", "demucs_env", "bin");
        const DEMUCS_BIN = process.env.DEMUCS_BIN || "demucs";
        const args = [
            "-d",
            "cpu",
            "-n",
            model,
            "--two-stems=vocals",
            "-j",
            "1",
            "--overlap",
            "0",
            inputPath,
        ];
        const proc = spawn(DEMUCS_BIN, args, {
            cwd: process.cwd(),
            env: { ...process.env, PATH: `${VENV_BIN}:${process.env.PATH}` },
        });
        proc.on("error", (err) => reject(err)); // ← important to prevent crashes
        proc.stdout.on("data", (d) => process.stdout.write(d));
        proc.stderr.on("data", (d) => process.stderr.write(d));
        proc.on("close", (code) => {
            try {
                fs.unlinkSync(inputPath);
            }
            catch { }
            if (code !== 0)
                return reject(new Error(`Demucs exited with code ${code}`));
            const stemBase = `/separated/${model}/${basename}`;
            resolve({
                vocalsUrl: `${stemBase}/vocals.wav`,
                accompanimentUrl: `${stemBase}/no_vocals.wav`,
            });
        });
    });
}
// Main handler
async function handleUpload(req, res) {
    try {
        console.log("request received");
        const file = req.file;
        if (!file) {
            res.status(400).json({
                success: false,
                message: "No music file received. Field name must be 'file'.",
            });
            return;
        }
        console.log(`[upload_music] ${file.originalname} -> ${file.size} bytes`);
        const basename = file.filename; // Multer's random name
        const { vocalsUrl, accompanimentUrl } = await runDemucs(file.path, basename);
        res.status(200).json({
            success: true,
            size: file.size,
            originalName: file.originalname,
            vocalsUrl,
            accompanimentUrl,
        });
        return;
    }
    catch (err) {
        console.error("[upload_music] error:", err);
        res.status(500).json({ success: false });
        return;
    }
}
// POST /upload_music
router.post("/upload_music", upload.single("file"), handleUpload);
export default router;
