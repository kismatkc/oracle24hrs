// app/music/controllers/download-mp3.ts

import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Type definitions
interface YtDlpMetadata {
  title?: string;
  fulltitle?: string;
  playlist_title?: string;
  uploader?: string;
  channel?: string;
  uploader_id?: string;
  duration?: number;
  view_count?: number;
  description?: string;
  upload_date?: string;
  thumbnail?: string;
}

interface ExtractedMetadata {
  title: string;
  author: string;
}

interface ProgressStore {
  [id: string]: number;
}

interface DownloadResponse {
  video_id: string;
  title: string;
  author: string;
  id: string;
  duration?: number;
  thumbnail?: string;
}

interface ErrorResponse {
  error: string;
}

interface ProgressResponse {
  progress: number;
}

interface VideoIdPattern {
  pattern: RegExp;
  groupIndex: number;
}

// Constants
const COMMON_ARGS: readonly string[] = [
  "--proxy",
  "http://10.8.0.2:3128",
  "--user-agent",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // Use Android client which has fewer restrictions on audio downloads
  "--extractor-args",
  "youtube:player_client=android",
] as const;

const HARD_TIMEOUT: number = 1000 * 180;
const MAX_ASSUMED_SIZE: number = 1024 * 1024 * 20;
const MIN_VALID_AUDIO_SIZE: number = 1024;

const progress: ProgressStore = {};

const setP = (id: string, p: number): void => {
  progress[id] = p;
  console.log("[setP]", id, p);
  // Auto-cleanup completed entries to prevent unbounded memory growth
  if (p >= 1) {
    setTimeout(() => {
      delete progress[id];
    }, 60_000);
  }
};

const router = express.Router();

async function streamToBuffer(
  r: NodeJS.ReadableStream,
  onChunk?: (f: number) => void,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let read: number = 0;

  for await (const c of r) {
    const buf = c as Buffer;
    chunks.push(buf);
    read += buf.length;

    if (onChunk) {
      const progressFraction = Math.min(0.95, read / MAX_ASSUMED_SIZE);
      onChunk(progressFraction);
    }
  }

  return Buffer.concat(chunks);
}

function extractVideoId(url: string): string {
  const patterns: VideoIdPattern[] = [
    {
      pattern:
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      groupIndex: 1,
    },
    {
      pattern: /^([a-zA-Z0-9_-]{11})$/,
      groupIndex: 1,
    },
  ];

  for (const { pattern, groupIndex } of patterns) {
    const match = url.match(pattern);
    if (match && match[groupIndex]) {
      return match[groupIndex];
    }
  }

  return "";
}

function generateFallbackMetadata(videoUrl: string): ExtractedMetadata {
  const videoId: string = extractVideoId(videoUrl);

  const fallbackTitles: readonly string[] = [
    "YouTube Video",
    "Music Track",
    "Audio Content",
    "Downloaded Audio",
    "YouTube Audio",
  ] as const;

  const fallbackAuthors: readonly string[] = [
    "Unknown Artist",
    "YouTube Creator",
    "Content Creator",
    "Various Artists",
  ] as const;

  const titleIndex: number = videoId
    ? videoId.charCodeAt(0) % fallbackTitles.length
    : 0;
  const authorIndex: number = videoId
    ? videoId.charCodeAt(1) % fallbackAuthors.length
    : 0;

  return {
    title:
      fallbackTitles[titleIndex] +
      (videoId ? ` (${videoId.substring(0, 6)})` : ""),
    author: fallbackAuthors[authorIndex],
  };
}

interface AudioHeader {
  isValid: boolean;
  format: "mp3" | "id3" | "unknown";
  bytes: number[];
}

function validateAudioHeader(buffer: Buffer): AudioHeader {
  if (buffer.length < 3) {
    return { isValid: false, format: "unknown", bytes: [] };
  }

  const header = buffer.slice(0, 3);
  const bytes = Array.from(header);

  if (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) {
    return { isValid: true, format: "mp3", bytes };
  }

  if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
    return { isValid: true, format: "id3", bytes };
  }

  return { isValid: false, format: "unknown", bytes };
}

function runYtDlpJson(videoUrl: string): Promise<YtDlpMetadata> {
  return new Promise((resolve, reject) => {
    const args: string[] = [...COMMON_ARGS, "-J", "--no-playlist", videoUrl];
    const proc: ChildProcess = spawn("yt-dlp", args);

    const outChunks: Buffer[] = [];
    let errText: string = "";

    proc.stdout?.on("data", (d: Buffer) => outChunks.push(d));
    proc.stderr?.on("data", (d: Buffer) => {
      errText += d.toString();
    });

    proc.on("error", (err: Error) => reject(err));

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        return reject(
          new Error(`yt-dlp metadata failed (code ${code}): ${errText}`),
        );
      }

      try {
        const raw: string = Buffer.concat(outChunks).toString("utf8");
        const json: YtDlpMetadata = JSON.parse(raw);
        resolve(json);
      } catch (e) {
        const error = e as Error;
        reject(new Error("Failed to parse yt-dlp JSON: " + error.message));
      }
    });
  });
}

function runYtDlpAudio(
  videoUrl: string,
  onProgress: (f: number) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tempFile: string = `/tmp/audio_${Date.now()}_${Math.random()
      .toString(36)
      .substring(7)}.mp3`;

    const args: string[] = [
      ...COMMON_ARGS,
      "-f",
      // Prefer iOS-compatible formats (M4A/AAC) which have fewer restrictions
      "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[ext=aac]/bestaudio[acodec=aac]/bestaudio/best",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      // Add retries for transient 403 errors
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "-o",
      tempFile,
      videoUrl,
    ];

    console.log("[yt-dlp] Running command:", "yt-dlp", args.join(" "));
    const proc: ChildProcess = spawn("yt-dlp", args);

    let errText: string = "";
    let progressReported: number = 0;

    proc.stderr?.on("data", (d: Buffer) => {
      const text: string = d.toString();
      errText += text;

      const progressMatch = text.match(/\[download\]\s+([0-9.]+)%/);
      if (progressMatch && progressMatch[1]) {
        const pct: number = parseFloat(progressMatch[1]);
        if (!Number.isNaN(pct) && pct > progressReported) {
          progressReported = pct;
          onProgress(pct / 100);
        }
      }
    });

    proc.on("error", (err: Error) => {
      console.error("[yt-dlp] Process error:", err);
      reject(err);
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        console.error("[yt-dlp] Exit code:", code);
        console.error("[yt-dlp] Error output:", errText);
        return reject(
          new Error(`yt-dlp download failed (code ${code}): ${errText}`),
        );
      }

      try {
        const fileBuffer: Buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);

        console.log(
          "[yt-dlp] Successfully downloaded audio file, size:",
          fileBuffer.length,
          "bytes",
        );

        if (fileBuffer.length < MIN_VALID_AUDIO_SIZE) {
          throw new Error("Downloaded file is too small to be valid audio");
        }

        const headerValidation: AudioHeader = validateAudioHeader(fileBuffer);

        if (headerValidation.isValid) {
          console.log(
            `[yt-dlp] Valid ${headerValidation.format.toUpperCase()} header detected`,
          );
        } else {
          console.warn(
            "[yt-dlp] Warning: Unexpected file header, but proceeding anyway",
          );
        }

        resolve(fileBuffer);
      } catch (fileError) {
        const error = fileError as Error;
        console.error("[yt-dlp] File read error:", error);
        reject(
          new Error(`Failed to read downloaded audio file: ${error.message}`),
        );
      }
    });
  });
}

// ─── YouTube streaming cache reuse ──────────────────────────────────────────
// If the song was already downloaded for streaming, reuse it instead of
// downloading again. The streaming controller caches to youtube-cache/.
const YOUTUBE_CACHE_DIR = path.join(process.cwd(), "youtube-cache");
const CACHE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days (must match youtube.ts)

function getStreamingCachedFile(videoId: string): string | null {
  if (!videoId) return null;
  const fp = path.join(YOUTUBE_CACHE_DIR, `${videoId}.mp3`);
  if (!fs.existsSync(fp)) return null;
  const stat = fs.statSync(fp);
  // Valid if > 10KB and not expired
  if (stat.size > 10_000 && Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
    return fp;
  }
  return null;
}

function getStreamingCachedMeta(videoId: string): {
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
} | null {
  try {
    const metaPath = path.join(YOUTUBE_CACHE_DIR, `${videoId}.meta.json`);
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

async function downloadMp3(
  req: Request,
  res: Response<DownloadResponse | ErrorResponse>,
): Promise<void> {
  const id: string = (req.query.id as string) || randomUUID();
  console.log("[dl] new request id", id, "url", req.query.url);

  const killer: NodeJS.Timeout = setTimeout(() => {
    setP(id, 1);
    res.status(504).json({ error: "Timed out" });
  }, HARD_TIMEOUT);

  try {
    const videoUrl: string = req.query.url as string;

    if (!videoUrl || typeof videoUrl !== "string") {
      throw new Error("URL parameter is required and must be a string");
    }

    if (!/^https?:\/\//i.test(videoUrl)) {
      throw new Error("Invalid URL format");
    }

    // ── Check streaming cache first ──────────────────────────────────────
    // Extract videoId from URL to check if we already have it cached
    const videoIdMatch =
      videoUrl.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      ) || videoUrl.match(/^([a-zA-Z0-9_-]{11})$/);
    const videoId = videoIdMatch?.[1] || "";

    if (videoId) {
      const cachedFile = getStreamingCachedFile(videoId);
      if (cachedFile) {
        console.log(
          `[dl] ✅ Reusing streaming cache for ${videoId} — skipping yt-dlp download`,
        );

        const cachedMeta = getStreamingCachedMeta(videoId);

        clearTimeout(killer);
        setP(id, 1);

        const response: DownloadResponse = {
          video_id: videoId,
          title: cachedMeta?.title || "YouTube Video",
          author: cachedMeta?.author || "Unknown Artist",
          duration: cachedMeta?.duration,
          thumbnail: cachedMeta?.thumbnail || "",
          id,
        };

        res.json(response);
        return;
      }
    }

    // ── Not cached — download fresh with yt-dlp ──────────────────────────

    let title: string = "";
    let author: string = "";
    let duration: number | undefined;
    let thumbnail: string = "";

    setP(id, 0.05);
    try {
      const meta: YtDlpMetadata = await runYtDlpJson(videoUrl);
      title = meta.title || meta.fulltitle || meta.playlist_title || "";
      author = meta.uploader || meta.channel || meta.uploader_id || "";
      duration = meta.duration;
      thumbnail = meta.thumbnail || "";
    } catch (e) {
      const error = e as Error;
      console.log("[dl] Metadata via yt-dlp failed:", error.message);
    }

    if (!title || !author) {
      const fallback: ExtractedMetadata = generateFallbackMetadata(videoUrl);
      title = title || fallback.title;
      author = author || fallback.author;
    }

    setP(id, 0.15);

    console.log("[dl] Starting yt-dlp audio download...");
    const audioBuf: Buffer = await runYtDlpAudio(videoUrl, (f: number) =>
      setP(id, 0.15 + f * 0.8),
    );

    // ── Save to streaming cache for binary serving via /youtube/audio ─────
    if (videoId) {
      try {
        if (!fs.existsSync(YOUTUBE_CACHE_DIR)) {
          fs.mkdirSync(YOUTUBE_CACHE_DIR, { recursive: true });
        }
        const cachePath = path.join(YOUTUBE_CACHE_DIR, `${videoId}.mp3`);
        if (!fs.existsSync(cachePath)) {
          fs.writeFileSync(cachePath, audioBuf);
          // Save metadata too
          const metaPath = path.join(YOUTUBE_CACHE_DIR, `${videoId}.meta.json`);
          fs.writeFileSync(
            metaPath,
            JSON.stringify({
              title,
              author,
              duration: duration || 0,
              thumbnail,
            }),
          );
          console.log(`[dl] Saved to streaming cache: ${videoId}`);
        }
      } catch (cacheErr) {
        console.log("[dl] Failed to save to streaming cache:", cacheErr);
      }
    }

    clearTimeout(killer);
    setP(id, 1);

    const response: DownloadResponse = {
      video_id: videoId,
      title,
      author,
      duration,
      thumbnail,
      id,
    };

    res.json(response);
  } catch (err) {
    clearTimeout(killer);
    setP(id, 1);

    const error = err as Error;
    console.log("[dl] error", error.message, error.stack);

    res.status(500).json({ error: error.message });
  }
}

function getProgress(req: Request, res: Response<ProgressResponse>): void {
  const id: string = req.params.id;
  const val: number = progress[id] ?? 0;

  console.log("[progress] id", id, "->", val);
  res.json({ progress: val });
}

router.get("/progress/:id", getProgress);
router.get("/download-mp3", downloadMp3);

export default router;
