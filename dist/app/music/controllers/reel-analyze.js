// app/music/controllers/reel-analyze.ts
// POST /api/reel/analyze  →  SSE stream
//
// Streams two independent pipelines:
//   Pipeline 1 — Audio Transcript  (yt-dlp → Groq Whisper)
//   Pipeline 2 — Visual Text        (yt-dlp video → ffmpeg frames → Groq Vision)
//
// SSE events:
//   data: { "type": "transcript",  "content": "..." }
//   data: { "type": "visualText",  "content": "..." }
//   data: { "type": "error",       "pipeline": "transcript"|"visualText", "error": "..." }
//   data: { "type": "done" }
import express from "express";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { rateLimit } from "express-rate-limit";
import Groq from "groq-sdk";
// ─── Constants ────────────────────────────────────────────────────────────────
const PROXY_URL = "http://10.8.0.2:3128";
const REEL_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const BASE_ARGS = ["--proxy", PROXY_URL, "--user-agent", REEL_UA];
const MAX_FRAMES = 20; // cap vision API calls per reel
const FRAME_SCALE = 512; // px width for extracted frames (keeps token count low)
const PIPELINE_TIMEOUT = 110000; // 110s — slightly under nginx 120s proxy timeout
// ─── Groq Clients ─────────────────────────────────────────────────────────────
const groq1 = new Groq({ apiKey: process.env.GROQ_API_KEY });
function getGroq2() {
    const key = process.env.GROQ_API_KEY_2;
    if (!key)
        throw new Error("GROQ_API_KEY_2 not configured — add it to Doppler");
    return new Groq({ apiKey: key });
}
// ─── URL Validation ───────────────────────────────────────────────────────────
function validateUrl(url) {
    if (!url || typeof url !== "string")
        return { valid: false, error: "url is required" };
    if (!/^https?:\/\//i.test(url))
        return { valid: false, error: "url must be HTTP/HTTPS" };
    if (!/instagram\.com/i.test(url))
        return { valid: false, error: "url must be an Instagram URL" };
    if (!/instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/.test(url))
        return { valid: false, error: "Could not extract reel shortcode from URL" };
    return { valid: true, url };
}
// ─── Cleanup Helpers ──────────────────────────────────────────────────────────
function cleanupFile(p) {
    if (!p)
        return;
    try {
        const base = p.replace(/\.[^.]+$/, "");
        const dir = path.dirname(p);
        const prefix = path.basename(base);
        for (const entry of fs.readdirSync(dir)) {
            if (entry.startsWith(prefix)) {
                try {
                    fs.unlinkSync(path.join(dir, entry));
                }
                catch { /* ignore */ }
            }
        }
    }
    catch { /* ignore */ }
}
function cleanupDir(dir) {
    if (!dir)
        return;
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    catch { /* ignore */ }
}
// ─── Pipeline 1 — Audio Transcript ───────────────────────────────────────────
function downloadAudio(reelUrl) {
    return new Promise((resolve, reject) => {
        const tempFile = `/tmp/analyze_audio_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
        const args = [
            ...BASE_ARGS,
            "-f", "bestaudio",
            "-x", "--audio-format", "mp3",
            "--audio-quality", "0",
            "--no-warnings", "--no-progress", "--no-part",
            "--retries", "3", "--fragment-retries", "3",
            "-o", tempFile,
            reelUrl,
        ];
        const proc = spawn("yt-dlp", args);
        let stderr = "";
        proc.stderr?.on("data", (d) => (stderr += d.toString()));
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code !== 0)
                return reject(new Error(`yt-dlp audio failed (${code}): ${stderr.slice(-200)}`));
            if (!fs.existsSync(tempFile))
                return reject(new Error("audio file not found after download"));
            resolve(tempFile);
        });
    });
}
async function transcribeAudio(filePath) {
    const result = await groq1.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-large-v3-turbo",
        response_format: "text",
        temperature: 0,
    });
    const text = typeof result === "string" ? result : (result.text ?? "");
    return text.trim();
}
async function runPipeline1(reelUrl) {
    let audioPath = null;
    try {
        audioPath = await downloadAudio(reelUrl);
        const transcript = await transcribeAudio(audioPath);
        if (!transcript)
            throw new Error("Whisper returned empty transcript");
        return transcript;
    }
    finally {
        cleanupFile(audioPath);
    }
}
// ─── Pipeline 2 — Visual Text ─────────────────────────────────────────────────
function downloadVideo(reelUrl) {
    return new Promise((resolve, reject) => {
        const tempFile = `/tmp/analyze_video_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
        const args = [
            ...BASE_ARGS,
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "--no-warnings", "--no-progress", "--no-part",
            "--retries", "3", "--fragment-retries", "3",
            "-o", tempFile,
            reelUrl,
        ];
        const proc = spawn("yt-dlp", args);
        let stderr = "";
        proc.stderr?.on("data", (d) => (stderr += d.toString()));
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code !== 0)
                return reject(new Error(`yt-dlp video failed (${code}): ${stderr.slice(-200)}`));
            if (!fs.existsSync(tempFile))
                return reject(new Error("video file not found after download"));
            resolve(tempFile);
        });
    });
}
function extractFrames(videoPath, framesDir) {
    return new Promise((resolve, reject) => {
        // 0.5fps = 1 frame every 2 seconds. Scale to FRAME_SCALE width, -2 = height auto (even).
        // -q:v 3: good quality JPEG, small enough for base64 API calls.
        const args = [
            "-i", videoPath,
            "-vf", `fps=1/2,scale=${FRAME_SCALE}:-2`,
            "-q:v", "3",
            "-frames:v", String(MAX_FRAMES),
            path.join(framesDir, "frame_%04d.jpg"),
        ];
        const proc = spawn("ffmpeg", args);
        let stderr = "";
        proc.stderr?.on("data", (d) => (stderr += d.toString()));
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code !== 0)
                return reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-200)}`));
            try {
                const files = fs.readdirSync(framesDir)
                    .filter((f) => f.endsWith(".jpg"))
                    .sort()
                    .map((f) => path.join(framesDir, f));
                resolve(files);
            }
            catch (e) {
                reject(e);
            }
        });
    });
}
async function extractTextFromFrame(imagePath, groq2) {
    const base64 = fs.readFileSync(imagePath).toString("base64");
    const resp = await groq2.chat.completions.create({
        model: "llama-3.2-11b-vision-preview",
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "image_url",
                        image_url: { url: `data:image/jpeg;base64,${base64}` },
                    },
                    {
                        type: "text",
                        text: "Extract ALL text visible in this image — captions, titles, subtitles, overlays, watermarks, UI labels. Return only the raw text exactly as it appears, one piece per line. If no text is visible, return nothing.",
                    },
                ],
            },
        ],
        max_tokens: 400,
        temperature: 0,
    });
    return resp.choices[0]?.message?.content?.trim() ?? "";
}
// Deduplicate consecutive near-identical frames.
// Two texts are "same" if normalised strings match OR if one is a prefix/suffix of the other (>80% overlap).
function deduplicateConsecutive(texts) {
    const kept = [];
    let prevNorm = "";
    for (const text of texts) {
        const t = text.trim();
        if (!t || t.length < 3)
            continue;
        const norm = t.toLowerCase().replace(/\s+/g, " ");
        if (norm === prevNorm)
            continue;
        // Fuzzy: skip if new text is contained in prev or prev contained in new
        const overlap = norm.includes(prevNorm) || prevNorm.includes(norm);
        if (overlap && prevNorm.length > 10)
            continue;
        kept.push(t);
        prevNorm = norm;
    }
    return kept.join("\n\n");
}
async function runPipeline2(reelUrl) {
    const groq2 = getGroq2();
    let videoPath = null;
    const framesDir = `/tmp/analyze_frames_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
        videoPath = await downloadVideo(reelUrl);
        fs.mkdirSync(framesDir, { recursive: true });
        const frames = await extractFrames(videoPath, framesDir);
        if (frames.length === 0)
            throw new Error("No frames extracted from video");
        console.log(`[reel-analyze] vision: processing ${frames.length} frames`);
        // Process frames sequentially to respect Groq rate limits
        const texts = [];
        for (const framePath of frames) {
            try {
                const text = await extractTextFromFrame(framePath, groq2);
                texts.push(text);
            }
            catch (err) {
                console.warn(`[reel-analyze] frame OCR failed: ${err.message}`);
                texts.push(""); // keep slot to preserve ordering
            }
        }
        const result = deduplicateConsecutive(texts);
        if (!result)
            throw new Error("No on-screen text detected in this reel");
        return result;
    }
    finally {
        cleanupFile(videoPath);
        cleanupDir(framesDir);
    }
}
// ─── SSE Handler ──────────────────────────────────────────────────────────────
async function analyzeReel(req, res) {
    const validation = validateUrl(req.body?.url);
    if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error });
        return;
    }
    const { url: reelUrl } = validation;
    console.log("[reel-analyze] SSE request:", reelUrl);
    // ── SSE headers ──
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering for SSE
    res.flushHeaders();
    const send = (data) => {
        if (!res.writableEnded)
            res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    // Overall safety timeout
    const killTimer = setTimeout(() => {
        send({ type: "error", pipeline: "global", error: "Analysis timed out" });
        if (!res.writableEnded)
            res.end();
    }, PIPELINE_TIMEOUT);
    let done = 0;
    const onDone = () => {
        done++;
        if (done === 2) {
            clearTimeout(killTimer);
            send({ type: "done" });
            res.end();
        }
    };
    // ── Pipeline 1 — Audio Transcript (fires immediately) ──
    runPipeline1(reelUrl)
        .then((transcript) => {
        console.log("[reel-analyze] transcript ready, length:", transcript.length);
        send({ type: "transcript", content: transcript });
    })
        .catch((err) => {
        console.error("[reel-analyze] P1 error:", err.message);
        send({ type: "error", pipeline: "transcript", error: err.message });
    })
        .finally(onDone);
    // ── Pipeline 2 — Visual Text (fires immediately, independent) ──
    runPipeline2(reelUrl)
        .then((text) => {
        console.log("[reel-analyze] visualText ready, length:", text.length);
        send({ type: "visualText", content: text });
    })
        .catch((err) => {
        console.error("[reel-analyze] P2 error:", err.message);
        send({ type: "error", pipeline: "visualText", error: err.message });
    })
        .finally(onDone);
}
// ─── Route Registration ───────────────────────────────────────────────────────
const analyzeLimiter = rateLimit({
    windowMs: 60000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    message: { success: false, error: "Too many analyze requests. Max 3 per minute." },
});
const router = express.Router();
router.post("/reel/analyze", analyzeLimiter, analyzeReel);
export default router;
