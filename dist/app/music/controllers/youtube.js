// app/music/controllers/youtube.ts
// Innertube API controller for YouTube search and streaming
import express from "express";
import { Innertube, UniversalCache } from "youtubei.js";
import { spawn } from "node:child_process";
const router = express.Router();
// Singleton Innertube instance (lazy init)
let innertubeClient = null;
let clientInitPromise = null;
let lastClientInit = 0;
const CLIENT_REFRESH_MS = 10 * 60 * 1000; // Refresh client every 10 minutes
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
// Helper to format duration from seconds to mm:ss or hh:mm:ss
function formatDuration(seconds) {
    if (!seconds || seconds <= 0)
        return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s
            .toString()
            .padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
}
// Helper to format view count
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
// Extract video info from search result item
function extractVideoInfo(item) {
    try {
        // Handle different result types
        const type = item?.type;
        if (type === "Video" || type === "CompactVideo" || type === "GridVideo") {
            const videoId = item.id || item.video_id;
            if (!videoId)
                return null;
            // Get thumbnail - try different paths
            let thumbnail = "";
            if (item.thumbnails && item.thumbnails.length > 0) {
                // Get highest quality thumbnail
                const thumbs = item.thumbnails.sort((a, b) => (b.width || 0) - (a.width || 0));
                thumbnail = thumbs[0]?.url || "";
            }
            else if (item.thumbnail?.url) {
                thumbnail = item.thumbnail.url;
            }
            // Get duration in seconds
            let durationSeconds = 0;
            if (item.duration?.seconds) {
                durationSeconds = item.duration.seconds;
            }
            else if (typeof item.duration === "number") {
                durationSeconds = item.duration;
            }
            // Get view count
            let viewCount = 0;
            if (item.view_count?.text) {
                const viewText = item.view_count.text.replace(/[^0-9]/g, "");
                viewCount = parseInt(viewText, 10) || 0;
            }
            else if (typeof item.view_count === "number") {
                viewCount = item.view_count;
            }
            else if (item.short_view_count?.text) {
                // Parse "1.2M views" format
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
            // Get author/channel
            const author = item.author?.name ||
                item.channel?.name ||
                item.owner?.name ||
                "Unknown";
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
        // Handle Shorts
        if (type === "ShortsLockupView" || type === "ReelShelf") {
            // Skip shorts for music app
            return null;
        }
        // Handle playlists (optional)
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
// GET /music/youtube/search?query=<query>
router.get("/search", async (req, res) => {
    try {
        const query = req.query.query?.trim();
        if (!query) {
            res.status(400).json({ error: "Query parameter is required" });
            return;
        }
        console.log("[youtube] Search request:", query);
        // Random delay to avoid rate limiting
        await randomDelay(300, 800);
        const yt = await getInnertubeClient();
        const searchResults = await yt.search(query, {
            type: "video",
            sort_by: "relevance",
        });
        const results = [];
        // Process results
        if (searchResults.results) {
            for (const item of searchResults.results) {
                const info = extractVideoInfo(item);
                if (info && info.videoId) {
                    results.push(info);
                }
                // Limit to 20 results
                if (results.length >= 20)
                    break;
            }
        }
        console.log(`[youtube] Search returned ${results.length} results`);
        res.json({
            query,
            results,
            count: results.length,
        });
    }
    catch (error) {
        console.error("[youtube] Search error:", error?.message || error);
        // Reset client on error
        innertubeClient = null;
        clientInitPromise = null;
        res.status(500).json({
            error: "Search failed",
            message: error?.message || "Unknown error",
            results: [],
        });
    }
});
// GET /music/youtube/suggestions?query=<partial_query>
router.get("/suggestions", async (req, res) => {
    try {
        const query = req.query.query?.trim();
        if (!query || query.length < 2) {
            res.json({ suggestions: [] });
            return;
        }
        console.log("[youtube] Suggestions request:", query);
        // Small delay
        await randomDelay(100, 300);
        const yt = await getInnertubeClient();
        // Use search suggestions
        const suggestions = await yt.getSearchSuggestions(query);
        // Extract suggestion strings
        const suggestionStrings = [];
        if (suggestions && Array.isArray(suggestions)) {
            for (const item of suggestions) {
                const suggestion = item;
                if (typeof suggestion === "string") {
                    suggestionStrings.push(suggestion);
                }
                else if (suggestion?.text) {
                    suggestionStrings.push(suggestion.text);
                }
                else if (suggestion?.query) {
                    suggestionStrings.push(suggestion.query);
                }
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
// yt-dlp with residential IP proxy - this is the key for avoiding bot detection
const YTDLP_COMMON_ARGS = [
    "--proxy",
    "http://10.8.0.2:3128",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];
async function getStreamUrlWithYtDlp(videoId) {
    return new Promise((resolve) => {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        // Use -j to get JSON output with URL, metadata, AND http_headers in one call
        // The http_headers are critical - YouTube CDN validates User-Agent matches the client type
        const args = [
            ...YTDLP_COMMON_ARGS,
            "-f",
            "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[ext=aac]/bestaudio[acodec=aac]/bestaudio",
            "-j", // JSON output - includes url, http_headers, and metadata
            "--no-playlist",
            "--no-warnings",
            videoUrl,
        ];
        console.log("[youtube] yt-dlp: Getting stream URL + headers for", videoId, "(via residential proxy)");
        const proc = spawn("yt-dlp", args);
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (d) => {
            stdout += d.toString();
        });
        proc.stderr?.on("data", (d) => {
            stderr += d.toString();
        });
        proc.on("error", (err) => {
            console.error("[youtube] yt-dlp spawn error:", err.message);
            resolve({
                url: null,
                httpHeaders: null,
                title: "",
                author: "",
                duration: 0,
                thumbnail: "",
                error: err.message,
            });
        });
        proc.on("close", (code) => {
            if (code !== 0 || !stdout.trim()) {
                console.error("[youtube] yt-dlp failed (code", code, "):", stderr);
                resolve({
                    url: null,
                    httpHeaders: null,
                    title: "",
                    author: "",
                    duration: 0,
                    thumbnail: "",
                    error: stderr || `Exit code ${code}`,
                });
                return;
            }
            try {
                const json = JSON.parse(stdout);
                const streamUrl = json.url || null;
                const httpHeaders = json.http_headers || null;
                if (streamUrl) {
                    console.log("[youtube] yt-dlp got stream URL:", streamUrl.substring(0, 80) + "...");
                    if (httpHeaders) {
                        console.log("[youtube] yt-dlp http_headers User-Agent:", httpHeaders["User-Agent"]?.substring(0, 60) || "none");
                    }
                }
                resolve({
                    url: streamUrl,
                    httpHeaders,
                    title: json.title || json.fulltitle || "",
                    author: json.uploader || json.channel || json.uploader_id || "",
                    duration: json.duration || 0,
                    thumbnail: json.thumbnail || "",
                    error: streamUrl ? null : "No URL in JSON output",
                });
            }
            catch (e) {
                console.error("[youtube] yt-dlp JSON parse error:", e.message);
                resolve({
                    url: null,
                    httpHeaders: null,
                    title: "",
                    author: "",
                    duration: 0,
                    thumbnail: "",
                    error: `JSON parse error: ${e.message}`,
                });
            }
        });
        // Timeout after 30 seconds
        setTimeout(() => {
            proc.kill();
            resolve({
                url: null,
                httpHeaders: null,
                title: "",
                author: "",
                duration: 0,
                thumbnail: "",
                error: "Timeout",
            });
        }, 30000);
    });
}
async function getYtDlpMetadata(videoId) {
    return new Promise((resolve, reject) => {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const args = [
            ...YTDLP_COMMON_ARGS,
            "-J", // JSON output
            "--no-playlist",
            "--no-warnings",
            videoUrl,
        ];
        const proc = spawn("yt-dlp", args);
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (d) => {
            stdout += d.toString();
        });
        proc.stderr?.on("data", (d) => {
            stderr += d.toString();
        });
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(stderr || `Exit code ${code}`));
                return;
            }
            try {
                const json = JSON.parse(stdout);
                resolve({
                    title: json.title || json.fulltitle || "",
                    author: json.uploader || json.channel || json.uploader_id || "",
                    duration: json.duration || 0,
                    thumbnail: json.thumbnail || "",
                });
            }
            catch (e) {
                reject(e);
            }
        });
        // Timeout
        setTimeout(() => {
            proc.kill();
            reject(new Error("Metadata timeout"));
        }, 15000);
    });
}
// GET /music/youtube/stream?video_id=<id>
router.get("/stream", async (req, res) => {
    try {
        const videoId = req.query.video_id?.trim();
        if (!videoId) {
            res.status(400).json({ error: "video_id parameter is required" });
            return;
        }
        console.log("[youtube] Stream request for:", videoId);
        await randomDelay(200, 600);
        let streamUrl = null;
        let httpHeaders = null;
        let title = "Unknown Title";
        let author = "Unknown Artist";
        let duration = 0;
        let thumbnail = "";
        let lastError = "Unknown error";
        let formatUsed = "";
        // Use yt-dlp directly - it's the most reliable method
        // Innertube methods consistently fail due to YouTube API changes
        try {
            console.log("[youtube] Using yt-dlp for stream...");
            const ytdlpResult = await getStreamUrlWithYtDlp(videoId);
            if (ytdlpResult.url) {
                streamUrl = ytdlpResult.url;
                httpHeaders = ytdlpResult.httpHeaders;
                formatUsed = "yt-dlp";
                title = ytdlpResult.title || title;
                author = ytdlpResult.author || author;
                duration = ytdlpResult.duration || duration;
                thumbnail = ytdlpResult.thumbnail || thumbnail;
                console.log("[youtube] yt-dlp succeeded");
            }
            else {
                lastError = ytdlpResult.error || "yt-dlp failed";
                console.log("[youtube] yt-dlp failed:", lastError);
            }
        }
        catch (e) {
            lastError = e?.message || "yt-dlp failed";
            console.error("[youtube] yt-dlp error:", lastError);
        }
        if (!streamUrl) {
            console.error(`[youtube] Failed to get stream for video: ${videoId}. Error: ${lastError}`);
            res.status(404).json({
                error: "No streaming data available",
                message: `Could not get stream for this video. ${lastError}. Try using 'Save MP3' to download instead.`,
                video_id: videoId,
                debug: {
                    lastError,
                    title,
                    author,
                },
            });
            return;
        }
        console.log(`[youtube] Stream ready: "${title}" by ${author} (${formatDuration(duration)})`);
        console.log(`[youtube] Format used: ${formatUsed}`);
        res.json({
            stream_url: streamUrl,
            headers: httpHeaders,
            video_id: videoId,
            title,
            author,
            duration,
            durationFormatted: formatDuration(duration),
            thumbnail,
        });
    }
    catch (error) {
        console.error("[youtube] Stream error:", error?.message || error);
        res.status(500).json({
            error: "Failed to get stream",
            message: error?.message || "Unknown error",
        });
    }
});
// GET /music/youtube/info?video_id=<id> - Get video info without stream URL
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
        res.status(500).json({
            error: "Failed to get info",
            message: error?.message || "Unknown error",
        });
    }
});
export default router;
