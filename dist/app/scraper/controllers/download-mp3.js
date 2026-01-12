// app/scraper/controllers/download-mp3.ts
import express from "express";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
// Constants - Use proxy configuration to match scrape-lyrics setup
const COMMON_ARGS = [
    "--proxy",
    "http://10.8.0.2:3128",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
];
const HARD_TIMEOUT = 1000 * 180; // 3 minutes
const MAX_ASSUMED_SIZE = 1024 * 1024 * 20; // 20MB
const MIN_VALID_AUDIO_SIZE = 1024; // 1KB
// Progress store
const progress = {};
const setP = (id, p) => {
    progress[id] = p;
    console.log("[setP]", id, p);
};
const router = express.Router();
/* ---------- Type-safe helpers ---------- */
async function streamToBuffer(r, onChunk) {
    const chunks = [];
    let read = 0;
    for await (const c of r) {
        const buf = c;
        chunks.push(buf);
        read += buf.length;
        if (onChunk) {
            // Simple progress based on bytes read
            const progressFraction = Math.min(0.95, read / MAX_ASSUMED_SIZE);
            onChunk(progressFraction);
        }
    }
    return Buffer.concat(chunks);
}
/* ---------- Video ID extraction ---------- */
function extractVideoId(url) {
    const patterns = [
        {
            pattern: /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
            groupIndex: 1
        },
        {
            pattern: /^([a-zA-Z0-9_-]{11})$/,
            groupIndex: 1
        }
    ];
    for (const { pattern, groupIndex } of patterns) {
        const match = url.match(pattern);
        if (match && match[groupIndex]) {
            return match[groupIndex];
        }
    }
    return "";
}
/* ---------- Fallback metadata generation ---------- */
function generateFallbackMetadata(videoUrl) {
    const videoId = extractVideoId(videoUrl);
    const fallbackTitles = [
        "YouTube Video",
        "Music Track",
        "Audio Content",
        "Downloaded Audio",
        "YouTube Audio"
    ];
    const fallbackAuthors = [
        "Unknown Artist",
        "YouTube Creator",
        "Content Creator",
        "Various Artists"
    ];
    const titleIndex = videoId ?
        videoId.charCodeAt(0) % fallbackTitles.length : 0;
    const authorIndex = videoId ?
        videoId.charCodeAt(1) % fallbackAuthors.length : 0;
    return {
        title: fallbackTitles[titleIndex] +
            (videoId ? ` (${videoId.substring(0, 6)})` : ""),
        author: fallbackAuthors[authorIndex]
    };
}
function validateAudioHeader(buffer) {
    if (buffer.length < 3) {
        return { isValid: false, format: 'unknown', bytes: [] };
    }
    const header = buffer.slice(0, 3);
    const bytes = Array.from(header);
    // Check for MP3 frame sync
    if (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) {
        return { isValid: true, format: 'mp3', bytes };
    }
    // Check for ID3 header
    if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
        return { isValid: true, format: 'id3', bytes };
    }
    return { isValid: false, format: 'unknown', bytes };
}
/* ---------- yt-dlp helpers ---------- */
function runYtDlpJson(videoUrl) {
    return new Promise((resolve, reject) => {
        const args = [...COMMON_ARGS, "-J", "--no-playlist", videoUrl];
        const proc = spawn("yt-dlp", args);
        const outChunks = [];
        let errText = "";
        proc.stdout?.on("data", (d) => outChunks.push(d));
        proc.stderr?.on("data", (d) => {
            errText += d.toString();
        });
        proc.on("error", (err) => reject(err));
        proc.on("close", (code) => {
            if (code !== 0) {
                return reject(new Error(`yt-dlp metadata failed (code ${code}): ${errText}`));
            }
            try {
                const raw = Buffer.concat(outChunks).toString("utf8");
                const json = JSON.parse(raw);
                resolve(json);
            }
            catch (e) {
                const error = e;
                reject(new Error("Failed to parse yt-dlp JSON: " + error.message));
            }
        });
    });
}
function runYtDlpAudio(videoUrl, onProgress) {
    return new Promise((resolve, reject) => {
        // Use a temporary file instead of stdout to avoid corruption
        const tempFile = `/tmp/audio_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
        const args = [
            ...COMMON_ARGS,
            "-f", "bestaudio/best",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0", // Best quality
            "--no-playlist",
            "--no-warnings", // Reduce stderr noise
            "--no-progress", // We'll track our own progress
            "-o", tempFile, // Output to temp file instead of stdout
            videoUrl
        ];
        console.log("[yt-dlp] Running command:", "yt-dlp", args.join(" "));
        const proc = spawn("yt-dlp", args);
        let errText = "";
        let progressReported = 0;
        proc.stderr?.on("data", (d) => {
            const text = d.toString();
            errText += text;
            // Parse progress like: [download]  42.3% ...
            const progressMatch = text.match(/\[download\]\s+([0-9.]+)%/);
            if (progressMatch && progressMatch[1]) {
                const pct = parseFloat(progressMatch[1]);
                if (!Number.isNaN(pct) && pct > progressReported) {
                    progressReported = pct;
                    onProgress(pct / 100);
                }
            }
        });
        proc.on("error", (err) => {
            console.error("[yt-dlp] Process error:", err);
            reject(err);
        });
        proc.on("close", (code) => {
            if (code !== 0) {
                console.error("[yt-dlp] Exit code:", code);
                console.error("[yt-dlp] Error output:", errText);
                return reject(new Error(`yt-dlp download failed (code ${code}): ${errText}`));
            }
            try {
                // Read the downloaded file
                const fileBuffer = fs.readFileSync(tempFile);
                // Clean up temp file
                fs.unlinkSync(tempFile);
                console.log("[yt-dlp] Successfully downloaded audio file, size:", fileBuffer.length, "bytes");
                // Verify it's actually an MP3 file
                if (fileBuffer.length < MIN_VALID_AUDIO_SIZE) {
                    throw new Error("Downloaded file is too small to be valid audio");
                }
                // Check for MP3 header
                const headerValidation = validateAudioHeader(fileBuffer);
                if (headerValidation.isValid) {
                    console.log(`[yt-dlp] Valid ${headerValidation.format.toUpperCase()} header detected`);
                }
                else {
                    console.warn("[yt-dlp] Warning: Unexpected file header, but proceeding anyway");
                    console.warn("[yt-dlp] First 16 bytes:", Array.from(fileBuffer.slice(0, 16))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join(' '));
                }
                resolve(fileBuffer);
            }
            catch (fileError) {
                const error = fileError;
                console.error("[yt-dlp] File read error:", error);
                reject(new Error(`Failed to read downloaded audio file: ${error.message}`));
            }
        });
    });
}
/* ---------- Main controller ---------- */
async function downloadMp3(req, res) {
    const id = req.query.id || randomUUID();
    console.log("[dl] new request id", id, "url", req.query.url);
    const killer = setTimeout(() => {
        setP(id, 1);
        res.status(504).json({ error: "Timed out" });
    }, HARD_TIMEOUT);
    try {
        const videoUrl = req.query.url;
        if (!videoUrl || typeof videoUrl !== 'string') {
            throw new Error("URL parameter is required and must be a string");
        }
        if (!/^https?:\/\//i.test(videoUrl)) {
            throw new Error("Invalid URL format");
        }
        let title = "";
        let author = "";
        /* 1. metadata via yt-dlp */
        setP(id, 0.05);
        try {
            const meta = await runYtDlpJson(videoUrl);
            // Extract metadata with proper null checks
            title = meta.title ||
                meta.fulltitle ||
                meta.playlist_title ||
                "";
            author = meta.uploader ||
                meta.channel ||
                meta.uploader_id ||
                "";
            console.log("[dl] Extracted metadata from yt-dlp:", {
                title: title.substring(0, 50) + (title.length > 50 ? "..." : ""),
                author: author.substring(0, 30) + (author.length > 30 ? "..." : "")
            });
        }
        catch (e) {
            const error = e;
            console.log("[dl] Metadata via yt-dlp failed:", error.message);
        }
        // Fallback metadata if needed
        if (!title || !author) {
            const fallback = generateFallbackMetadata(videoUrl);
            const originalTitle = title;
            const originalAuthor = author;
            title = title || fallback.title;
            author = author || fallback.author;
            console.log("[dl] Using fallback metadata:", {
                originalTitle,
                originalAuthor,
                finalTitle: title,
                finalAuthor: author
            });
        }
        setP(id, 0.15);
        /* 2. download / convert via yt-dlp */
        console.log("[dl] Starting yt-dlp audio download...");
        const audioBuf = await runYtDlpAudio(videoUrl, (f) => setP(id, 0.15 + f * 0.8));
        const base64Buffer = audioBuf.toString("base64");
        clearTimeout(killer);
        setP(id, 1);
        console.log("[dl] Download complete, buffer size:", base64Buffer.length);
        // Type-safe response
        const response = {
            base64Buffer,
            title,
            author,
            id
        };
        res.json(response);
    }
    catch (err) {
        clearTimeout(killer);
        setP(id, 1);
        const error = err;
        console.log("[dl] error", error.message, error.stack);
        const errorResponse = {
            error: error.message
        };
        res.status(500).json(errorResponse);
    }
}
/* ---------- Progress endpoint ---------- */
function getProgress(req, res) {
    const id = req.params.id;
    const val = progress[id] ?? 0;
    console.log("[progress] id", id, "->", val);
    const response = {
        progress: val
    };
    res.json(response);
}
// Route definitions with proper typing
router.get("/progress/:id", getProgress);
router.get("/download-mp3", downloadMp3);
export default router;
