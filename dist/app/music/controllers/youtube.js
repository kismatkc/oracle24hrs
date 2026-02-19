// app/music/controllers/youtube.ts
// Innertube API controller for YouTube search and streaming
// activeDownloads state stored in Redis for PM2 cluster-mode safety
import express from "express";
import { Innertube, UniversalCache } from "youtubei.js";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { appRedis } from "../../../lib/appRedis.js";
const router = express.Router();
const PROXY_URL = "http://10.8.0.2:3128";
// ─── File-based audio cache ──────────────────────────────────────────────────
const CACHE_DIR = path.join(process.cwd(), "youtube-cache");
const CACHE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
// Ensure cache directory exists on startup
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log("[youtube] Created cache directory:", CACHE_DIR);
}
// ─── Redis-backed download tracking ─────────────────────────────────────────
// Key pattern:  app:download:<videoId>   (app: prefix added by appRedis keyPrefix)
// Fields: progress, status, error, title, author, duration, thumbnail
// TTL: 1 hour (auto-cleanup)
const DL_PREFIX = "download:";
const DL_TTL = 3600; // 1 hour
async function setDownload(videoId, data) {
    const key = DL_PREFIX + videoId;
    await appRedis.hset(key, {
        progress: String(data.progress),
        status: data.status,
        error: data.error || "",
        title: data.title || "",
        author: data.author || "",
        duration: String(data.duration || 0),
        thumbnail: data.thumbnail || "",
    });
    await appRedis.expire(key, DL_TTL);
}
async function getDownload(videoId) {
    const key = DL_PREFIX + videoId;
    const raw = await appRedis.hgetall(key);
    if (!raw || !raw.status)
        return null;
    return {
        progress: parseFloat(raw.progress) || 0,
        status: raw.status,
        error: raw.error || undefined,
        title: raw.title || "",
        author: raw.author || "",
        duration: parseInt(raw.duration) || 0,
        thumbnail: raw.thumbnail || "",
    };
}
async function hasDownload(videoId) {
    const key = DL_PREFIX + videoId;
    return (await appRedis.exists(key)) === 1;
}
async function deleteDownload(videoId) {
    const key = DL_PREFIX + videoId;
    await appRedis.del(key);
}
async function updateDownloadField(videoId, field, value) {
    const key = DL_PREFIX + videoId;
    await appRedis.hset(key, field, value);
}
// Cleanup cached files older than 5 days - runs every hour
setInterval(() => {
    try {
        const now = Date.now();
        for (const file of fs.readdirSync(CACHE_DIR)) {
            const filePath = path.join(CACHE_DIR, file);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > CACHE_MAX_AGE_MS) {
                fs.unlinkSync(filePath);
                console.log("[youtube] Cleaned up old cache file:", file);
            }
        }
    }
    catch (e) {
        console.error("[youtube] Cache cleanup error:", e.message);
    }
}, 60 * 60 * 1000);
function getCachedFilePath(videoId) {
    return path.join(CACHE_DIR, `${videoId}.mp3`);
}
function getCachedMetaPath(videoId) {
    return path.join(CACHE_DIR, `${videoId}.meta.json`);
}
function saveCachedMeta(videoId, meta) {
    try {
        fs.writeFileSync(getCachedMetaPath(videoId), JSON.stringify(meta));
    }
    catch { }
}
function loadCachedMeta(videoId) {
    try {
        const fp = getCachedMetaPath(videoId);
        if (!fs.existsSync(fp))
            return null;
        return JSON.parse(fs.readFileSync(fp, "utf8"));
    }
    catch {
        return null;
    }
}
function isCached(videoId) {
    const fp = getCachedFilePath(videoId);
    if (!fs.existsSync(fp))
        return false;
    const stat = fs.statSync(fp);
    return stat.size > 10000 && Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS;
}
// ─── Singleton Innertube (per-worker, safe in cluster) ───────────────────────
let innertubeClient = null;
let clientInitPromise = null;
let lastClientInit = 0;
const CLIENT_REFRESH_MS = 10 * 60 * 1000;
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];
const randomDelay = (min = 500, max = 2000) => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
async function getInnertubeClient(forceNew = false) {
    const now = Date.now();
    const needsRefresh = now - lastClientInit > CLIENT_REFRESH_MS;
    if (innertubeClient && !forceNew && !needsRefresh) {
        return innertubeClient;
    }
    if (forceNew || needsRefresh) {
        innertubeClient = null;
        clientInitPromise = null;
        console.log("[youtube] Creating fresh Innertube client...");
    }
    if (!clientInitPromise) {
        clientInitPromise = Innertube.create({
            retrieve_player: true,
            generate_session_locally: true,
            cache: new UniversalCache(false),
        });
    }
    innertubeClient = await clientInitPromise;
    lastClientInit = Date.now();
    console.log("[youtube] Innertube client initialized");
    return innertubeClient;
}
function formatDuration(seconds) {
    if (!seconds || seconds <= 0)
        return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
}
function formatViews(views) {
    if (!views)
        return "";
    if (views >= 1000000000)
        return `${(views / 1000000000).toFixed(1)}B views`;
    if (views >= 1000000)
        return `${(views / 1000000).toFixed(1)}M views`;
    if (views >= 1000)
        return `${(views / 1000).toFixed(1)}K views`;
    return `${views} views`;
}
function extractVideoInfo(item) {
    try {
        const type = item?.type;
        if (type === "Video" || type === "CompactVideo" || type === "GridVideo") {
            const videoId = item.id || item.video_id;
            if (!videoId)
                return null;
            let thumbnail = "";
            if (item.thumbnails && item.thumbnails.length > 0) {
                const thumbs = item.thumbnails.sort((a, b) => (b.width || 0) - (a.width || 0));
                thumbnail = thumbs[0]?.url || "";
            }
            else if (item.thumbnail?.url) {
                thumbnail = item.thumbnail.url;
            }
            let durationSeconds = 0;
            if (item.duration?.seconds) {
                durationSeconds = item.duration.seconds;
            }
            else if (typeof item.duration === "number") {
                durationSeconds = item.duration;
            }
            let viewCount = 0;
            if (item.view_count?.text) {
                const viewText = item.view_count.text.replace(/[^0-9]/g, "");
                viewCount = parseInt(viewText, 10) || 0;
            }
            else if (typeof item.view_count === "number") {
                viewCount = item.view_count;
            }
            else if (item.short_view_count?.text) {
                const match = item.short_view_count.text.match(/([0-9.]+)\s*([KMB])?/i);
                if (match) {
                    let num = parseFloat(match[1]);
                    const suffix = (match[2] || "").toUpperCase();
                    if (suffix === "K")
                        num *= 1000;
                    else if (suffix === "M")
                        num *= 1000000;
                    else if (suffix === "B")
                        num *= 1000000000;
                    viewCount = Math.floor(num);
                }
            }
            const author = item.author?.name || item.channel?.name || item.owner?.name || "Unknown";
            return {
                videoId,
                title: item.title?.text || item.title || "Untitled",
                thumbnail,
                duration: formatDuration(durationSeconds),
                durationSeconds,
                views: formatViews(viewCount),
                viewCount,
                author,
                type: "video",
            };
        }
        if (type === "ShortsLockupView" || type === "ReelShelf")
            return null;
        if (type === "Playlist" || type === "CompactPlaylist") {
            const playlistId = item.id || item.playlist_id;
            if (!playlistId)
                return null;
            let thumbnail = "";
            if (item.thumbnails && item.thumbnails.length > 0) {
                thumbnail = item.thumbnails[0]?.url || "";
            }
            return {
                playlistId,
                videoId: null,
                title: item.title?.text || item.title || "Untitled Playlist",
                thumbnail,
                videoCount: item.video_count || item.video_count_text?.text || "",
                author: item.author?.name || "Unknown",
                type: "playlist",
            };
        }
        return null;
    }
    catch (e) {
        console.error("[youtube] Error extracting video info:", e);
        return null;
    }
}
// ─── Search ──────────────────────────────────────────────────────────────────
router.get("/search", async (req, res) => {
    try {
        const query = req.query.query?.trim();
        if (!query) {
            res.status(400).json({ error: "Query parameter is required" });
            return;
        }
        console.log("[youtube] Search request:", query);
        await randomDelay(300, 800);
        const yt = await getInnertubeClient();
        const searchResults = await yt.search(query, { type: "video", sort_by: "relevance" });
        const results = [];
        if (searchResults.results) {
            for (const item of searchResults.results) {
                const info = extractVideoInfo(item);
                if (info && info.videoId)
                    results.push(info);
                if (results.length >= 20)
                    break;
            }
        }
        console.log(`[youtube] Search returned ${results.length} results`);
        res.json({ query, results, count: results.length });
    }
    catch (error) {
        console.error("[youtube] Search error:", error?.message || error);
        innertubeClient = null;
        clientInitPromise = null;
        res.status(500).json({ error: "Search failed", message: error?.message || "Unknown error", results: [] });
    }
});
// ─── Suggestions ─────────────────────────────────────────────────────────────
router.get("/suggestions", async (req, res) => {
    try {
        const query = req.query.query?.trim();
        if (!query || query.length < 2) {
            res.json({ suggestions: [] });
            return;
        }
        console.log("[youtube] Suggestions request:", query);
        await randomDelay(100, 300);
        const yt = await getInnertubeClient();
        const suggestions = await yt.getSearchSuggestions(query);
        const suggestionStrings = [];
        if (suggestions && Array.isArray(suggestions)) {
            for (const item of suggestions) {
                const suggestion = item;
                if (typeof suggestion === "string")
                    suggestionStrings.push(suggestion);
                else if (suggestion?.text)
                    suggestionStrings.push(suggestion.text);
                else if (suggestion?.query)
                    suggestionStrings.push(suggestion.query);
                if (suggestionStrings.length >= 8)
                    break;
            }
        }
        res.json({ suggestions: suggestionStrings });
    }
    catch (error) {
        console.error("[youtube] Suggestions error:", error?.message || error);
        res.json({ suggestions: [] });
    }
});
// ─── yt-dlp helpers ──────────────────────────────────────────────────────────
const YTDLP_COMMON_ARGS = [
    "--proxy",
    "http://10.8.0.2:3128",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "--extractor-args",
    "youtube:player_client=android",
];
async function getStreamUrlWithYtDlp(videoId) {
    return new Promise((resolve) => {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const args = [
            ...YTDLP_COMMON_ARGS,
            "-f", "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[ext=aac]/bestaudio[acodec=aac]/bestaudio",
            "-j",
            "--no-playlist",
            "--no-warnings",
            videoUrl,
        ];
        console.log("[youtube] yt-dlp: Getting metadata for", videoId);
        const proc = spawn("yt-dlp", args);
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (d) => { stdout += d.toString(); });
        proc.stderr?.on("data", (d) => { stderr += d.toString(); });
        proc.on("error", (err) => {
            console.error("[youtube] yt-dlp spawn error:", err.message);
            resolve({ url: null, httpHeaders: null, title: "", author: "", duration: 0, thumbnail: "", error: err.message });
        });
        proc.on("close", (code) => {
            if (code !== 0 || !stdout.trim()) {
                console.error("[youtube] yt-dlp failed (code", code, "):", stderr);
                resolve({ url: null, httpHeaders: null, title: "", author: "", duration: 0, thumbnail: "", error: stderr || `Exit code ${code}` });
                return;
            }
            try {
                const json = JSON.parse(stdout);
                resolve({
                    url: json.url || null,
                    httpHeaders: json.http_headers || null,
                    title: json.title || json.fulltitle || "",
                    author: json.uploader || json.channel || json.uploader_id || "",
                    duration: json.duration || 0,
                    thumbnail: json.thumbnail || "",
                    error: null,
                });
            }
            catch (e) {
                resolve({ url: null, httpHeaders: null, title: "", author: "", duration: 0, thumbnail: "", error: `JSON parse error: ${e.message}` });
            }
        });
        setTimeout(() => {
            proc.kill();
            resolve({ url: null, httpHeaders: null, title: "", author: "", duration: 0, thumbnail: "", error: "Timeout" });
        }, 30000);
    });
}
// ─── Background download to disk (Redis-tracked) ────────────────────────────
function startBackgroundDownload(videoId) {
    const entry = {
        progress: 0,
        status: "downloading",
        title: "",
        author: "",
        duration: 0,
        thumbnail: "",
    };
    // Write initial state to Redis
    setDownload(videoId, entry).catch((err) => console.error("[audio-cache] Redis write error:", err.message));
    const outPath = getCachedFilePath(videoId);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const args = [
        ...YTDLP_COMMON_ARGS,
        "-f", "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[ext=aac]/bestaudio[acodec=aac]/bestaudio/best",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--no-playlist",
        "--no-warnings",
        "--newline",
        "--retries", "3",
        "--fragment-retries", "3",
        "-o", outPath,
        videoUrl,
    ];
    console.log(`[audio-cache] Starting download for ${videoId} -> ${outPath}`);
    const proc = spawn("yt-dlp", args);
    let stderrBuf = "";
    proc.stdout?.on("data", (d) => {
        const text = d.toString();
        const match = text.match(/\[download\]\s+([0-9.]+)%/);
        if (match) {
            const pct = parseFloat(match[1]);
            if (!Number.isNaN(pct)) {
                const progress = Math.min(pct / 100, 0.99);
                updateDownloadField(videoId, "progress", String(progress)).catch(() => { });
            }
        }
    });
    proc.stderr?.on("data", (d) => {
        const text = d.toString();
        stderrBuf += text;
        const match = text.match(/\[download\]\s+([0-9.]+)%/);
        if (match) {
            const pct = parseFloat(match[1]);
            if (!Number.isNaN(pct)) {
                const progress = Math.min(pct / 100, 0.99);
                updateDownloadField(videoId, "progress", String(progress)).catch(() => { });
            }
        }
    });
    proc.on("error", (err) => {
        console.error(`[audio-cache] Spawn error for ${videoId}:`, err.message);
        setDownload(videoId, { ...entry, status: "error", error: err.message }).catch(() => { });
        setTimeout(() => deleteDownload(videoId).catch(() => { }), 60000);
    });
    proc.on("close", (code) => {
        if (code !== 0) {
            console.error(`[audio-cache] yt-dlp failed for ${videoId} (code ${code}):`, stderrBuf.slice(-500));
            setDownload(videoId, { ...entry, status: "error", error: stderrBuf.slice(-200) || `Exit code ${code}` }).catch(() => { });
            setTimeout(() => deleteDownload(videoId).catch(() => { }), 60000);
            return;
        }
        if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10000) {
            setDownload(videoId, { ...entry, status: "error", error: "Downloaded file missing or too small" }).catch(() => { });
            setTimeout(() => deleteDownload(videoId).catch(() => { }), 60000);
            return;
        }
        console.log(`[audio-cache] Download complete for ${videoId} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);
        // Read latest metadata from Redis (may have been updated by parallel metadata fetch)
        getDownload(videoId).then((latest) => {
            const finalEntry = {
                progress: 1,
                status: "done",
                title: latest?.title || entry.title || "",
                author: latest?.author || entry.author || "",
                duration: latest?.duration || entry.duration || 0,
                thumbnail: latest?.thumbnail || entry.thumbnail || "",
            };
            setDownload(videoId, finalEntry).catch(() => { });
            saveCachedMeta(videoId, {
                title: finalEntry.title,
                author: finalEntry.author,
                duration: finalEntry.duration,
                thumbnail: finalEntry.thumbnail,
            });
            // Keep entry for 5 min so late pollers still see "done"
            setTimeout(() => deleteDownload(videoId).catch(() => { }), 5 * 60000);
        }).catch(() => {
            // Fallback: just mark done
            setDownload(videoId, { ...entry, progress: 1, status: "done" }).catch(() => { });
            setTimeout(() => deleteDownload(videoId).catch(() => { }), 5 * 60000);
        });
    });
    // Fetch metadata in parallel (non-blocking)
    getStreamUrlWithYtDlp(videoId)
        .then((meta) => {
        // Update only metadata fields, don't overwrite progress/status
        const pipe = appRedis.pipeline();
        const key = DL_PREFIX + videoId;
        if (meta.title)
            pipe.hset(key, "title", meta.title);
        if (meta.author)
            pipe.hset(key, "author", meta.author);
        if (meta.duration)
            pipe.hset(key, "duration", String(meta.duration));
        if (meta.thumbnail)
            pipe.hset(key, "thumbnail", meta.thumbnail);
        pipe.exec().catch(() => { });
    })
        .catch(() => { });
    // Safety timeout - kill after 3 minutes
    setTimeout(() => {
        getDownload(videoId).then((current) => {
            if (current && current.status === "downloading") {
                proc.kill();
                setDownload(videoId, { ...current, status: "error", error: "Download timeout (3 min)" }).catch(() => { });
                setTimeout(() => deleteDownload(videoId).catch(() => { }), 60000);
            }
        }).catch(() => {
            proc.kill();
        });
    }, 180000);
}
// ─── GET /audio/prepare?video_id=<id> ────────────────────────────────────────
router.get("/audio/prepare", async (req, res) => {
    const videoId = req.query.video_id?.trim();
    if (!videoId) {
        res.status(400).json({ error: "video_id parameter is required" });
        return;
    }
    // 1. Already cached on disk -> ready immediately
    if (isCached(videoId)) {
        const active = await getDownload(videoId);
        const cachedMeta = loadCachedMeta(videoId);
        res.json({
            status: "ready",
            progress: 1,
            video_id: videoId,
            title: active?.title || cachedMeta?.title || "",
            author: active?.author || cachedMeta?.author || "",
            duration: active?.duration || cachedMeta?.duration || 0,
            thumbnail: active?.thumbnail || cachedMeta?.thumbnail || "",
        });
        return;
    }
    // 2. Download in progress -> return current progress from Redis
    const active = await getDownload(videoId);
    if (active) {
        res.json({
            status: active.status,
            progress: active.progress,
            video_id: videoId,
            title: active.title,
            author: active.author,
            duration: active.duration,
            thumbnail: active.thumbnail,
            error: active.error,
        });
        return;
    }
    // 3. Not started -> kick off background download
    startBackgroundDownload(videoId);
    res.json({
        status: "downloading",
        progress: 0,
        video_id: videoId,
        title: "",
        author: "",
        duration: 0,
        thumbnail: "",
    });
});
// ─── GET /audio/check?video_id=<id> ──────────────────────────────────────────
router.get("/audio/check", async (req, res) => {
    const videoId = req.query.video_id?.trim();
    if (!videoId) {
        res.status(400).json({ error: "video_id parameter is required" });
        return;
    }
    if (isCached(videoId)) {
        const cachedMeta = loadCachedMeta(videoId);
        res.json({
            cached: true,
            video_id: videoId,
            title: cachedMeta?.title || "",
            author: cachedMeta?.author || "",
            duration: cachedMeta?.duration || 0,
            thumbnail: cachedMeta?.thumbnail || "",
        });
    }
    else {
        res.json({ cached: false, video_id: videoId });
    }
});
// ─── GET /audio?video_id=<id> ────────────────────────────────────────────────
router.get("/audio", async (req, res) => {
    const videoId = req.query.video_id?.trim();
    if (!videoId) {
        res.status(400).json({ error: "video_id parameter is required" });
        return;
    }
    const filePath = getCachedFilePath(videoId);
    if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "Audio not ready", message: "Call /audio/prepare first and wait for status=ready" });
        return;
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 10000) {
        res.status(404).json({ error: "Cached file is corrupted" });
        return;
    }
    console.log(`[audio] Serving cached file for ${videoId}`, `(${(stat.size / 1024 / 1024).toFixed(1)} MB)`, req.headers.range ? `Range: ${req.headers.range}` : "(full)");
    res.sendFile(filePath, {
        headers: {
            "Content-Type": "audio/mpeg",
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
        },
    });
});
// ─── GET /stream ─────────────────────────────────────────────────────────────
router.get("/stream", async (req, res) => {
    try {
        const videoId = req.query.video_id?.trim();
        if (!videoId) {
            res.status(400).json({ error: "video_id parameter is required" });
            return;
        }
        console.log("[youtube] Stream metadata request for:", videoId);
        await randomDelay(200, 600);
        const result = await getStreamUrlWithYtDlp(videoId);
        if (!result.url) {
            res.status(404).json({
                error: "No streaming data available",
                message: result.error || "Could not get stream for this video",
                video_id: videoId,
            });
            return;
        }
        res.json({
            stream_url: result.url,
            headers: result.httpHeaders,
            video_id: videoId,
            title: result.title,
            author: result.author,
            duration: result.duration,
            durationFormatted: formatDuration(result.duration),
            thumbnail: result.thumbnail,
        });
    }
    catch (error) {
        console.error("[youtube] Stream error:", error?.message || error);
        res.status(500).json({ error: "Failed to get stream", message: error?.message || "Unknown error" });
    }
});
// ─── GET /info ───────────────────────────────────────────────────────────────
router.get("/info", async (req, res) => {
    try {
        const videoId = req.query.video_id?.trim();
        if (!videoId) {
            res.status(400).json({ error: "video_id parameter is required" });
            return;
        }
        await randomDelay(100, 400);
        const yt = await getInnertubeClient();
        const info = await yt.getBasicInfo(videoId);
        if (!info) {
            res.status(404).json({ error: "Video not found" });
            return;
        }
        const basicInfo = info.basic_info;
        let thumbnail = "";
        if (basicInfo?.thumbnail && basicInfo.thumbnail.length > 0) {
            thumbnail = basicInfo.thumbnail[0]?.url || "";
        }
        res.json({
            video_id: videoId,
            title: basicInfo?.title || "Unknown",
            author: basicInfo?.author || "Unknown",
            duration: basicInfo?.duration || 0,
            durationFormatted: formatDuration(basicInfo?.duration),
            thumbnail,
            view_count: basicInfo?.view_count || 0,
        });
    }
    catch (error) {
        console.error("[youtube] Info error:", error?.message || error);
        res.status(500).json({ error: "Failed to get info", message: error?.message || "Unknown error" });
    }
});
export default router;
