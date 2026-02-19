// app/music/controllers/shazam.ts
// Shazam song recognition via shazamio Python backend
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
const router = express.Router();
const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, "uploads", "shazam-tmp");
fs.mkdirSync(TMP_DIR, { mode: 0o770, recursive: true });
const RECOGNIZE_SCRIPT = path.join(ROOT, "scripts", "recognize.py");
/* ---------- multer — single "audio" field, max 10 MB ---------- */
const upload = multer({
    dest: TMP_DIR,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = file.mimetype.startsWith("audio/") ||
            file.mimetype === "application/octet-stream"; // iOS sometimes sends this
        cb(null, ok);
    },
});
/* ---------- POST /shazam/recognize ---------- */
router.post("/shazam/recognize", upload.single("audio"), async (req, res) => {
    const file = req.file;
    if (!file) {
        res.status(400).json({ success: false, error: "no audio file provided" });
        return;
    }
    const filePath = file.path;
    console.log(`[shazam] Received ${file.originalname} (${(file.size / 1024).toFixed(1)} KB) → ${filePath}`);
    try {
        const result = await runPython(filePath);
        console.log(`[shazam] ${result.success ? "Match" : "No match"}: ${result.title || result.error || "—"}`);
        if (result.success) {
            res.json(result);
        }
        else {
            res.status(404).json(result);
        }
    }
    catch (err) {
        console.error("[shazam] Error:", err.message || err);
        res.status(500).json({ success: false, error: err.message || "internal error" });
    }
    finally {
        // Clean up temp file
        fs.unlink(filePath, () => { });
    }
});
/* ---------- helper: spawn python3 recognize.py ---------- */
function runPython(audioPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn("python3", [RECOGNIZE_SCRIPT, audioPath], {
            timeout: 30000,
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (chunk) => (stdout += chunk));
        proc.stderr.on("data", (chunk) => (stderr += chunk));
        proc.on("close", (code) => {
            if (stderr)
                console.warn("[shazam/py stderr]", stderr.trim());
            try {
                // Parse only the LAST line that looks like JSON
                const lines = stdout.trim().split("\n");
                const jsonLine = lines.reverse().find((l) => l.startsWith("{"));
                if (!jsonLine)
                    throw new Error("No JSON in python output");
                resolve(JSON.parse(jsonLine));
            }
            catch (e) {
                reject(new Error(`Python exited ${code}, parse error: ${e.message}\nstdout: ${stdout}\nstderr: ${stderr}`));
            }
        });
        proc.on("error", (err) => reject(err));
    });
}
export default router;
