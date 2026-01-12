// app/scraper/controllers/download-mp3.ts

import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import { ReadStream } from "node:fs";
import * as fs from "node:fs";

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
  base64Buffer: string;
  title: string;
  author: string;
  id: string;
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

// Constants - Use proxy configuration to match scrape-lyrics setup
const COMMON_ARGS: readonly string[] = [
  "--proxy",
  "http://10.8.0.2:3128",
  "--user-agent",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
] as const;

const HARD_TIMEOUT: number = 1000 * 180; // 3 minutes
const MAX_ASSUMED_SIZE: number = 1024 * 1024 * 20; // 20MB
const MIN_VALID_AUDIO_SIZE: number = 1024; // 1KB

// Progress store
const progress: ProgressStore = {};

const setP = (id: string, p: number): void => {
  progress[id] = p;
  console.log("[setP]", id, p);
};

const router = express.Router();

/* ---------- Type-safe helpers ---------- */

async function streamToBuffer(
  r: NodeJS.ReadableStream,
  onChunk?: (f: number) => void
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let read: number = 0;
  
  for await (const c of r) {
    const buf = c as Buffer;
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

function extractVideoId(url: string): string {
  const patterns: VideoIdPattern[] = [
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

function generateFallbackMetadata(videoUrl: string): ExtractedMetadata {
  const videoId: string = extractVideoId(videoUrl);
  
  const fallbackTitles: readonly string[] = [
    "YouTube Video",
    "Music Track",
    "Audio Content",
    "Downloaded Audio",
    "YouTube Audio"
  ] as const;
  
  const fallbackAuthors: readonly string[] = [
    "Unknown Artist",
    "YouTube Creator",
    "Content Creator",
    "Various Artists"
  ] as const;

  const titleIndex: number = videoId ? 
    videoId.charCodeAt(0) % fallbackTitles.length : 0;
  const authorIndex: number = videoId ? 
    videoId.charCodeAt(1) % fallbackAuthors.length : 0;

  return {
    title: fallbackTitles[titleIndex] + 
           (videoId ? ` (${videoId.substring(0, 6)})` : ""),
    author: fallbackAuthors[authorIndex]
  };
}

/* ---------- Audio file validation ---------- */

interface AudioHeader {
  isValid: boolean;
  format: 'mp3' | 'id3' | 'unknown';
  bytes: number[];
}

function validateAudioHeader(buffer: Buffer): AudioHeader {
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
          new Error(`yt-dlp metadata failed (code ${code}): ${errText}`)
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
  onProgress: (f: number) => void
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Use a temporary file instead of stdout to avoid corruption
    const tempFile: string = `/tmp/audio_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
    
    const args: string[] = [
      ...COMMON_ARGS,
      "-f", "bestaudio/best",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",  // Best quality
      "--no-playlist",
      "--no-warnings",         // Reduce stderr noise
      "--no-progress",         // We'll track our own progress
      "-o", tempFile,          // Output to temp file instead of stdout
      videoUrl
    ];

    console.log("[yt-dlp] Running command:", "yt-dlp", args.join(" "));
    const proc: ChildProcess = spawn("yt-dlp", args);

    let errText: string = "";
    let progressReported: number = 0;

    proc.stderr?.on("data", (d: Buffer) => {
      const text: string = d.toString();
      errText += text;

      // Parse progress like: [download]  42.3% ...
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
          new Error(`yt-dlp download failed (code ${code}): ${errText}`)
        );
      }
      
      try {
        // Read the downloaded file
        const fileBuffer: Buffer = fs.readFileSync(tempFile);
        
        // Clean up temp file
        fs.unlinkSync(tempFile);
        
        console.log("[yt-dlp] Successfully downloaded audio file, size:", fileBuffer.length, "bytes");
        
        // Verify it's actually an MP3 file
        if (fileBuffer.length < MIN_VALID_AUDIO_SIZE) {
          throw new Error("Downloaded file is too small to be valid audio");
        }
        
        // Check for MP3 header
        const headerValidation: AudioHeader = validateAudioHeader(fileBuffer);
        
        if (headerValidation.isValid) {
          console.log(`[yt-dlp] Valid ${headerValidation.format.toUpperCase()} header detected`);
        } else {
          console.warn("[yt-dlp] Warning: Unexpected file header, but proceeding anyway");
          console.warn("[yt-dlp] First 16 bytes:", 
            Array.from(fileBuffer.slice(0, 16))
              .map(b => b.toString(16).padStart(2, '0'))
              .join(' ')
          );
        }
        
        resolve(fileBuffer);
      } catch (fileError) {
        const error = fileError as Error;
        console.error("[yt-dlp] File read error:", error);
        reject(new Error(`Failed to read downloaded audio file: ${error.message}`));
      }
    });
  });
}

/* ---------- Main controller ---------- */

async function downloadMp3(req: Request, res: Response<DownloadResponse | ErrorResponse>): Promise<void> {
  const id: string = (req.query.id as string) || randomUUID();
  console.log("[dl] new request id", id, "url", req.query.url);

  const killer: NodeJS.Timeout = setTimeout(() => {
    setP(id, 1);
    res.status(504).json({ error: "Timed out" });
  }, HARD_TIMEOUT);

  try {
    const videoUrl: string = req.query.url as string;
    
    if (!videoUrl || typeof videoUrl !== 'string') {
      throw new Error("URL parameter is required and must be a string");
    }
    
    if (!/^https?:\/\//i.test(videoUrl)) {
      throw new Error("Invalid URL format");
    }

    let title: string = "";
    let author: string = "";

    /* 1. metadata via yt-dlp */
    setP(id, 0.05);
    try {
      const meta: YtDlpMetadata = await runYtDlpJson(videoUrl);

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
    } catch (e) {
      const error = e as Error;
      console.log("[dl] Metadata via yt-dlp failed:", error.message);
    }

    // Fallback metadata if needed
    if (!title || !author) {
      const fallback: ExtractedMetadata = generateFallbackMetadata(videoUrl);
      const originalTitle: string = title;
      const originalAuthor: string = author;

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
    const audioBuf: Buffer = await runYtDlpAudio(videoUrl, (f: number) =>
      setP(id, 0.15 + f * 0.8)
    );

    const base64Buffer: string = audioBuf.toString("base64");

    clearTimeout(killer);
    setP(id, 1);

    console.log(
      "[dl] Download complete, buffer size:",
      base64Buffer.length
    );

    // Type-safe response
    const response: DownloadResponse = {
      base64Buffer,
      title,
      author,
      id
    };

    res.json(response);
  } catch (err) {
    clearTimeout(killer);
    setP(id, 1);
    
    const error = err as Error;
    console.log("[dl] error", error.message, error.stack);
    
    const errorResponse: ErrorResponse = {
      error: error.message
    };
    
    res.status(500).json(errorResponse);
  }
}

/* ---------- Progress endpoint ---------- */
function getProgress(req: Request, res: Response<ProgressResponse>): void {
  const id: string = req.params.id;
  const val: number = progress[id] ?? 0;
  
  console.log("[progress] id", id, "->", val);
  
  const response: ProgressResponse = {
    progress: val
  };
  
  res.json(response);
}

// Route definitions with proper typing
router.get("/progress/:id", getProgress);
router.get("/download-mp3", downloadMp3);

export default router;
export type { 
  YtDlpMetadata, 
  ExtractedMetadata, 
  DownloadResponse, 
  ErrorResponse, 
  ProgressResponse,
  AudioHeader
};
