// app/music/controllers/youtube.ts
// Innertube API controller for YouTube search and streaming

import express, { Request, Response } from "express";
import { Innertube, UniversalCache, ClientType } from "youtubei.js";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

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

// Track in-progress downloads so multiple clients can poll the same job
interface ActiveDownload {
  progress: number; // 0 → 1
  status: "downloading" | "done" | "error";
  error?: string;
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
}
const activeDownloads = new Map<string, ActiveDownload>();

// Cleanup cached files older than 5 days — runs every hour
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
  } catch (e: any) {
    console.error("[youtube] Cache cleanup error:", e.message);
  }
}, 60 * 60 * 1000);

function getCachedFilePath(videoId: string): string {
  return path.join(CACHE_DIR, `${videoId}.mp3`);
}

function getCachedMetaPath(videoId: string): string {
  return path.join(CACHE_DIR, `${videoId}.meta.json`);
}

interface CachedMeta {
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
}

function saveCachedMeta(videoId: string, meta: CachedMeta): void {
  try {
    fs.writeFileSync(getCachedMetaPath(videoId), JSON.stringify(meta));
  } catch {}
}

function loadCachedMeta(videoId: string): CachedMeta | null {
  try {
    const fp = getCachedMetaPath(videoId);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function isCached(videoId: string): boolean {
  const fp = getCachedFilePath(videoId);
  if (!fs.existsSync(fp)) return false;
  const stat = fs.statSync(fp);
  // Valid if > 10KB and < 5 days old
  return stat.size > 10_000 && Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS;
}

// ─── Singleton Innertube ─────────────────────────────────────────────────────

let innertubeClient: Innertube | null = null;
let clientInitPromise: Promise<Innertube> | null = null;
let lastClientInit = 0;
const CLIENT_REFRESH_MS = 10 * 60 * 1000;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];

const randomDelay = (min = 500, max = 2000) =>
  new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );

const getRandomUserAgent = () =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

async function getInnertubeClient(forceNew = false): Promise<Innertube> {
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

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "0:00";
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

function formatViews(views?: number): string {
  if (!views) return "";
  if (views >= 1_000_000_000)
    return `${(views / 1_000_000_000).toFixed(1)}B views`;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K views`;
  return `${views} views`;
}

function extractVideoInfo(item: any): any | null {
  try {
    const type = item?.type;

    if (type === "Video" || type === "CompactVideo" || type === "GridVideo") {
      const videoId = item.id || item.video_id;
      if (!videoId) return null;

      let thumbnail = "";
      if (item.thumbnails && item.thumbnails.length > 0) {
        const thumbs = item.thumbnails.sort(
          (a: any, b: any) => (b.width || 0) - (a.width || 0)
        );
        thumbnail = thumbs[0]?.url || "";
      } else if (item.thumbnail?.url) {
        thumbnail = item.thumbnail.url;
      }

      let durationSeconds = 0;
      if (item.duration?.seconds) {
        durationSeconds = item.duration.seconds;
      } else if (typeof item.duration === "number") {
        durationSeconds = item.duration;
      }

      let viewCount = 0;
      if (item.view_count?.text) {
        const viewText = item.view_count.text.replace(/[^0-9]/g, "");
        viewCount = parseInt(viewText, 10) || 0;
      } else if (typeof item.view_count === "number") {
        viewCount = item.view_count;
      } else if (item.short_view_count?.text) {
        const match = item.short_view_count.text.match(/([0-9.]+)\s*([KMB])?/i);
        if (match) {
          let num = parseFloat(match[1]);
          const suffix = (match[2] || "").toUpperCase();
          if (suffix === "K") num *= 1000;
          else if (suffix === "M") num *= 1_000_000;
          else if (suffix === "B") num *= 1_000_000_000;
          viewCount = Math.floor(num);
        }
      }

      const author =
        item.author?.name ||
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

    if (type === "ShortsLockupView" || type === "ReelShelf") {
      return null;
    }

    if (type === "Playlist" || type === "CompactPlaylist") {
      const playlistId = item.id || item.playlist_id;
      if (!playlistId) return null;

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
  } catch (e) {
    console.error("[youtube] Error extracting video info:", e);
    return null;
  }
}

// ─── Search ──────────────────────────────────────────────────────────────────

router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = (req.query.query as string)?.trim();

    if (!query) {
      res.status(400).json({ error: "Query parameter is required" });
      return;
    }

    console.log("[youtube] Search request:", query);
    await randomDelay(300, 800);

    const yt = await getInnertubeClient();
    const searchResults = await yt.search(query, {
      type: "video",
      sort_by: "relevance",
    });

    const results: any[] = [];

    if (searchResults.results) {
      for (const item of searchResults.results) {
        const info = extractVideoInfo(item);
        if (info && info.videoId) {
          results.push(info);
        }
        if (results.length >= 20) break;
      }
    }

    console.log(`[youtube] Search returned ${results.length} results`);

    res.json({
      query,
      results,
      count: results.length,
    });
  } catch (error: any) {
    console.error("[youtube] Search error:", error?.message || error);
    innertubeClient = null;
    clientInitPromise = null;

    res.status(500).json({
      error: "Search failed",
      message: error?.message || "Unknown error",
      results: [],
    });
  }
});

// ─── Suggestions ─────────────────────────────────────────────────────────────

router.get("/suggestions", async (req: Request, res: Response) => {
  try {
    const query = (req.query.query as string)?.trim();

    if (!query || query.length < 2) {
      res.json({ suggestions: [] });
      return;
    }

    console.log("[youtube] Suggestions request:", query);
    await randomDelay(100, 300);

    const yt = await getInnertubeClient();
    const suggestions = await yt.getSearchSuggestions(query);

    const suggestionStrings: string[] = [];
    if (suggestions && Array.isArray(suggestions)) {
      for (const item of suggestions) {
        const suggestion = item as any;
        if (typeof suggestion === "string") {
          suggestionStrings.push(suggestion);
        } else if (suggestion?.text) {
          suggestionStrings.push(suggestion.text);
        } else if (suggestion?.query) {
          suggestionStrings.push(suggestion.query);
        }
        if (suggestionStrings.length >= 8) break;
      }
    }

    res.json({ suggestions: suggestionStrings });
  } catch (error: any) {
    console.error("[youtube] Suggestions error:", error?.message || error);
    res.json({ suggestions: [] });
  }
});

// ─── yt-dlp helpers ──────────────────────────────────────────────────────────

const YTDLP_COMMON_ARGS: readonly string[] = [
  "--proxy",
  "http://10.8.0.2:3128",
  "--user-agent",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "--extractor-args",
  "youtube:player_client=android",
] as const;

interface YtDlpStreamResult {
  url: string | null;
  httpHeaders: Record<string, string> | null;
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  error: string | null;
}

async function getStreamUrlWithYtDlp(
  videoId: string
): Promise<YtDlpStreamResult> {
  return new Promise((resolve) => {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const args: string[] = [
      ...YTDLP_COMMON_ARGS,
      "-f",
      "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[ext=aac]/bestaudio[acodec=aac]/bestaudio",
      "-j",
      "--no-playlist",
      "--no-warnings",
      videoUrl,
    ];

    console.log("[youtube] yt-dlp: Getting metadata for", videoId);

    const proc = spawn("yt-dlp", args);

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });

    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("error", (err: Error) => {
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

    proc.on("close", (code: number | null) => {
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
        resolve({
          url: json.url || null,
          httpHeaders: json.http_headers || null,
          title: json.title || json.fulltitle || "",
          author: json.uploader || json.channel || json.uploader_id || "",
          duration: json.duration || 0,
          thumbnail: json.thumbnail || "",
          error: null,
        });
      } catch (e: any) {
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

// ─── Background download to disk ────────────────────────────────────────────
// Downloads the audio file with yt-dlp into youtube-cache/<videoId>.mp3
// and tracks progress so the frontend can poll it.

function startBackgroundDownload(videoId: string): void {
  // If already in progress, skip
  if (activeDownloads.has(videoId)) return;

  const entry: ActiveDownload = {
    progress: 0,
    status: "downloading",
    title: "",
    author: "",
    duration: 0,
    thumbnail: "",
  };
  activeDownloads.set(videoId, entry);

  const outPath = getCachedFilePath(videoId);
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const args: string[] = [
    ...YTDLP_COMMON_ARGS,
    "-f",
    "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[ext=aac]/bestaudio[acodec=aac]/bestaudio/best",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--no-playlist",
    "--no-warnings",
    "--newline", // force progress on separate lines so we can parse %
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "-o",
    outPath,
    videoUrl,
  ];

  console.log(`[audio-cache] Starting download for ${videoId} → ${outPath}`);
  const proc = spawn("yt-dlp", args);

  let stderrBuf = "";

  proc.stdout?.on("data", (d: Buffer) => {
    const text = d.toString();
    // yt-dlp with --newline prints progress to stdout
    const match = text.match(/\[download\]\s+([0-9.]+)%/);
    if (match) {
      const pct = parseFloat(match[1]);
      if (!Number.isNaN(pct)) {
        entry.progress = Math.min(pct / 100, 0.99);
      }
    }
  });

  proc.stderr?.on("data", (d: Buffer) => {
    const text = d.toString();
    stderrBuf += text;

    // Also try parsing progress from stderr (some yt-dlp versions)
    const match = text.match(/\[download\]\s+([0-9.]+)%/);
    if (match) {
      const pct = parseFloat(match[1]);
      if (!Number.isNaN(pct)) {
        entry.progress = Math.min(pct / 100, 0.99);
      }
    }
  });

  proc.on("error", (err: Error) => {
    console.error(`[audio-cache] Spawn error for ${videoId}:`, err.message);
    entry.status = "error";
    entry.error = err.message;
    // Clean up after 60s so a retry can happen
    setTimeout(() => activeDownloads.delete(videoId), 60_000);
  });

  proc.on("close", (code: number | null) => {
    if (code !== 0) {
      console.error(
        `[audio-cache] yt-dlp failed for ${videoId} (code ${code}):`,
        stderrBuf.slice(-500)
      );
      entry.status = "error";
      entry.error = stderrBuf.slice(-200) || `Exit code ${code}`;
      setTimeout(() => activeDownloads.delete(videoId), 60_000);
      return;
    }

    // Verify file exists and is valid
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10_000) {
      entry.status = "error";
      entry.error = "Downloaded file missing or too small";
      setTimeout(() => activeDownloads.delete(videoId), 60_000);
      return;
    }

    console.log(
      `[audio-cache] Download complete for ${videoId}`,
      `(${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`
    );
    entry.progress = 1;
    entry.status = "done";

    // Save metadata to sidecar file
    saveCachedMeta(videoId, {
      title: entry.title,
      author: entry.author,
      duration: entry.duration,
      thumbnail: entry.thumbnail,
    });

    // Keep the entry around for 5 minutes so late pollers see "done"
    setTimeout(() => activeDownloads.delete(videoId), 5 * 60_000);
  });

  // Also fetch metadata in parallel (non-blocking) so we can return it in prepare
  getStreamUrlWithYtDlp(videoId)
    .then((meta) => {
      entry.title = meta.title || "";
      entry.author = meta.author || "";
      entry.duration = meta.duration || 0;
      entry.thumbnail = meta.thumbnail || "";
    })
    .catch(() => {});

  // Safety timeout — kill after 3 minutes
  setTimeout(() => {
    if (entry.status === "downloading") {
      proc.kill();
      entry.status = "error";
      entry.error = "Download timeout (3 min)";
      setTimeout(() => activeDownloads.delete(videoId), 60_000);
    }
  }, 180_000);
}

// ─── GET /audio/prepare?video_id=<id> ────────────────────────────────────────
// Kicks off download if needed, returns current status + progress for polling.
router.get("/audio/prepare", async (req: Request, res: Response) => {
  const videoId = (req.query.video_id as string)?.trim();
  if (!videoId) {
    res.status(400).json({ error: "video_id parameter is required" });
    return;
  }

  // 1. Already cached on disk → ready immediately
  if (isCached(videoId)) {
    const active = activeDownloads.get(videoId);
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

  // 2. Download in progress → return current progress
  const active = activeDownloads.get(videoId);
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

  // 3. Not started → kick off background download
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
// Quick check if audio is already cached — does NOT trigger a download.
// Used by frontend to skip the progress bar for already-cached songs.
router.get("/audio/check", async (req: Request, res: Response) => {
  const videoId = (req.query.video_id as string)?.trim();
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
  } else {
    res.json({ cached: false, video_id: videoId });
  }
});

// ─── GET /audio?video_id=<id> ────────────────────────────────────────────────
// Serves the cached MP3 file. Supports Range requests (Express sendFile does
// this automatically).
router.get("/audio", async (req: Request, res: Response) => {
  const videoId = (req.query.video_id as string)?.trim();
  if (!videoId) {
    res.status(400).json({ error: "video_id parameter is required" });
    return;
  }

  const filePath = getCachedFilePath(videoId);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({
      error: "Audio not ready",
      message: "Call /audio/prepare first and wait for status=ready",
    });
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.size < 10_000) {
    res.status(404).json({ error: "Cached file is corrupted" });
    return;
  }

  console.log(
    `[audio] Serving cached file for ${videoId}`,
    `(${(stat.size / 1024 / 1024).toFixed(1)} MB)`,
    req.headers.range ? `Range: ${req.headers.range}` : "(full)"
  );

  // sendFile handles Range headers, Content-Type, etc.
  res.sendFile(filePath, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

// ─── GET /stream (kept for metadata — frontend may still call it) ────────────

router.get("/stream", async (req: Request, res: Response) => {
  try {
    const videoId = (req.query.video_id as string)?.trim();

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
  } catch (error: any) {
    console.error("[youtube] Stream error:", error?.message || error);
    res.status(500).json({
      error: "Failed to get stream",
      message: error?.message || "Unknown error",
    });
  }
});

// ─── GET /info ───────────────────────────────────────────────────────────────

router.get("/info", async (req: Request, res: Response) => {
  try {
    const videoId = (req.query.video_id as string)?.trim();

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
  } catch (error: any) {
    console.error("[youtube] Info error:", error?.message || error);
    res.status(500).json({
      error: "Failed to get info",
      message: error?.message || "Unknown error",
    });
  }
});

export default router;
