// app/music/controllers/reel.ts
// POST /api/reel/transcript
// Downloads Instagram Reel audio via yt-dlp (residential proxy),
// then transcribes with Groq Whisper whisper-large-v3-turbo.

import express, { Request, Response } from "express";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { rateLimit } from "express-rate-limit";
import Groq from "groq-sdk";

// ─── Constants ────────────────────────────────────────────────────────────────

// Matches the hardcoded proxy in download-mp3.ts:59 and youtube.ts:14
const PROXY_URL = "http://10.8.0.2:3128";

// Mobile iOS UA — Instagram CDN responds better to mobile clients for reels.
// ⚠️ No --extractor-args youtube:player_client=android — that flag is YouTube-only.
const REEL_ARGS_BASE: readonly string[] = [
  "--proxy",
  PROXY_URL,
  "--user-agent",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
] as const;

const HARD_TIMEOUT_MS = 120_000; // 2 min — matches nginx proxy_read_timeout 120s
const MIN_AUDIO_BYTES = 1024;

// Wipe the output file AND any intermediate files yt-dlp might leave behind
// e.g. reel_1234_abc.mp3, reel_1234_abc.webm, reel_1234_abc.m4a, reel_1234_abc.mp3.part
function cleanupTempFiles(tempFile: string): void {
  const base = tempFile.replace(/\.[^.]+$/, ""); // strip extension
  try {
    const dir = path.dirname(tempFile);
    const prefix = path.basename(base);
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        try {
          fs.unlinkSync(`${dir}/${entry}`);
        } catch {}
      }
    }
  } catch {}
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const router = express.Router();

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
// 5 req/min per IP per worker. With 4 PM2 workers the practical ceiling is
// ~20/min per IP if nginx load-balances across instances.
// For true cluster-wide enforcement, wire in rate-limit-redis with appRedis later.

const reelRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: { success: false, error: "Too many requests. Max 5 per minute." },
});

// ─── URL Validation & Shortcode Extraction ───────────────────────────────────

function extractReelShortcode(url: string): string | null {
  // Covers: /reel/CODE/, /reels/CODE/, /p/CODE/, /tv/CODE/
  // With or without trailing slash, with any query params (?igsh=..., etc.)
  const match = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

type ValidationOk = { valid: true; url: string; shortcode: string };
type ValidationFail = { valid: false; error: string };
type ValidationResult = ValidationOk | ValidationFail;

function validateReelUrl(url: unknown): ValidationResult {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "url field is required and must be a string" };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { valid: false, error: "url must be a valid HTTP/HTTPS URL" };
  }
  if (!/instagram\.com/i.test(url)) {
    return { valid: false, error: "url must be an Instagram URL" };
  }
  const shortcode = extractReelShortcode(url);
  if (!shortcode) {
    return {
      valid: false,
      error:
        "Could not extract reel shortcode from URL. Supported formats: /reel/CODE/, /p/CODE/, /tv/CODE/",
    };
  }
  return { valid: true, url, shortcode };
}

// ─── yt-dlp: Metadata (duration) ─────────────────────────────────────────────
// Non-critical — resolves 0 on any failure. Runs in parallel with audio download.
// Mirrors runYtDlpJson in download-mp3.ts:190-222.

function getReelDuration(reelUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const args = [...REEL_ARGS_BASE, "-J", "--no-playlist", reelUrl];
    const proc = spawn("yt-dlp", args);
    const chunks: Buffer[] = [];

    proc.stdout?.on("data", (d: Buffer) => chunks.push(d));
    proc.on("error", () => resolve(0));
    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        resolve(0);
        return;
      }
      try {
        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(typeof json.duration === "number" ? Math.round(json.duration) : 0);
      } catch {
        resolve(0);
      }
    });

    // Don't let a slow metadata call block the whole request
    setTimeout(() => {
      proc.kill();
      resolve(0);
    }, 30_000);
  });
}

// ─── yt-dlp: Audio Download ───────────────────────────────────────────────────
// Mirrors runYtDlpAudio in download-mp3.ts:224-326.
// Uses -x --audio-format mp3 so yt-dlp calls ffmpeg internally — no separate step.

function downloadReelAudio(reelUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Temp file pattern from download-mp3.ts:229-231
    const tempFile = `/tmp/reel_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;

    const args: string[] = [
      ...REEL_ARGS_BASE,
      "-f",
      "bestaudio",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--no-warnings",
      "--no-progress",
      "--no-part",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "-o",
      tempFile,
      reelUrl,
    ];

    console.log("[reel] yt-dlp download starting for:", reelUrl);
    const proc = spawn("yt-dlp", args);
    let stderr = "";

    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("error", (err: Error) => {
      console.error("[reel] spawn error:", err.message);
      reject(err);
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        console.error("[reel] yt-dlp exited", code, stderr.slice(-500));
        reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(-300)}`));
        return;
      }

      if (!fs.existsSync(tempFile)) {
        reject(new Error("yt-dlp exited 0 but output file not found"));
        return;
      }

      const size = fs.statSync(tempFile).size;
      if (size < MIN_AUDIO_BYTES) {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
        reject(new Error(`Downloaded audio file too small (${size} bytes)`));
        return;
      }

      console.log("[reel] audio downloaded, size:", size, "bytes, path:", tempFile);
      resolve(tempFile);
    });
  });
}

// ─── Groq Whisper Transcription ───────────────────────────────────────────────

async function transcribeAudio(filePath: string): Promise<string> {
  console.log("[reel] sending to Groq Whisper...");

  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-large-v3-turbo",
    response_format: "text",
    // language: "en",  // omit for auto language detection (reels are multilingual)
    temperature: 0,
  });

  // groq-sdk returns a bare string when response_format is "text"
  const text =
    typeof transcription === "string"
      ? transcription
      : ((transcription as any).text ?? "");

  return text.trim();
}

// ─── Main Route Handler ───────────────────────────────────────────────────────

async function transcribeReel(req: Request, res: Response): Promise<void> {
  const validation = validateReelUrl(req.body?.url);

  if (!validation.valid) {
    res.status(400).json({ success: false, error: validation.error });
    return;
  }

  const { url: reelUrl } = validation;
  let tempFilePath: string | null = null;

  console.log("[reel] transcript request:", reelUrl);

  // Hard timeout guard — mirrors download-mp3.ts:368-371
  const timeoutHandle = setTimeout(() => {
    console.error("[reel] hard timeout (120s) hit for:", reelUrl);
    if (!res.headersSent) {
      res.status(504).json({ success: false, error: "Request timed out" });
    }
  }, HARD_TIMEOUT_MS);

  try {
    // Run duration fetch and audio download in parallel.
    // getReelDuration is non-critical — if it fails the transcript still returns.
    const [durationResult, audioPathResult] = await Promise.allSettled([
      getReelDuration(reelUrl),
      downloadReelAudio(reelUrl),
    ]);

    if (audioPathResult.status === "rejected") {
      throw audioPathResult.reason as Error;
    }

    tempFilePath = audioPathResult.value;
    const duration =
      durationResult.status === "fulfilled" && durationResult.value > 0
        ? durationResult.value
        : undefined;

    console.log("[reel] audio ready, duration:", duration ?? "unknown");

    const transcript = await transcribeAudio(tempFilePath);

    console.log("[reel] transcription done, length:", transcript.length, "chars");

    clearTimeout(timeoutHandle);

    const response: {
      success: boolean;
      transcript: string;
      reelUrl: string;
      duration?: number;
    } = { success: true, transcript, reelUrl };

    if (duration !== undefined) {
      response.duration = duration;
    }

    res.json(response);
  } catch (err: any) {
    clearTimeout(timeoutHandle);
    console.error("[reel] error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  } finally {
    // Wipe temp file + any yt-dlp intermediate files (*.webm, *.m4a, *.part, etc.)
    if (tempFilePath) {
      cleanupTempFiles(tempFilePath);
    }
  }
}

// ─── Route Registration ───────────────────────────────────────────────────────

router.post("/reel/transcript", reelRateLimiter, transcribeReel);

export default router;
