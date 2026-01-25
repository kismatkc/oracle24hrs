// app/music/workers/demucs.worker.ts
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { Worker, Job } from "bullmq";
import { BullRedis as Redis } from "../../../lib/bullRedis.ts";

const ROOT = process.cwd();
const SEPARATED_DIR = path.join(ROOT, "separated");
const NORMALIZED_DIR = path.join(ROOT, "normalized");
fs.mkdirSync(SEPARATED_DIR, { recursive: true });
fs.mkdirSync(NORMALIZED_DIR, { recursive: true });

// 6-stem types for htdemucs_6s model
type StemType = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";
const ALL_STEMS: StemType[] = ["vocals", "drums", "bass", "guitar", "piano", "other"];

type Result = {
  vocalsUrl: string;
  drumsUrl: string;
  bassUrl: string;
  guitarUrl: string;
  pianoUrl: string;
  otherUrl: string;
  // Legacy compatibility for existing apps
  accompanimentUrl: string;
  instrumentalUrl: string;
  sepDir: string;
};

// Use htdemucs_6s for 6-stem separation (vocals, drums, bass, guitar, piano, other)
const model = process.env.DEMUCS_MODEL || "htdemucs_6s";

// CPU thread optimization for Oracle Ampere A1 (4 vCPU)
const CPU_THREADS = parseInt(process.env.DEMUCS_THREADS || "4", 10);

function resolveFfmpeg(): string {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  try {
    const inst = require("@ffmpeg-installer/ffmpeg");
    if (inst?.path) return inst.path as string;
  } catch {}
  return "ffmpeg";
}

function runProc(
  cmd: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env });
    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d) => (stdout += d.toString()));
    p.stderr?.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}: ${stderr}`))
    );
  });
}

/**
 * FFmpeg Normalization Pre-processing
 * Converts input to 44.1kHz, 16-bit WAV for optimal Demucs processing
 * This fixes "glitchy/corrupted" audio artifacts
 */
async function normalizeAudio(inputPath: string, outputPath: string): Promise<boolean> {
  const ffmpeg = resolveFfmpeg();
  
  try {
    await runProc(ffmpeg, ["-version"]);
  } catch {
    console.warn("[demucs] FFmpeg not available, skipping normalization");
    return false;
  }

  try {
    // Normalize to 44.1kHz, 16-bit signed PCM WAV
    // -af loudnorm applies EBU R128 loudness normalization
    await runProc(ffmpeg, [
      "-y",
      "-i", inputPath,
      "-ar", "44100",           // 44.1kHz sample rate (CD quality)
      "-ac", "2",               // Stereo
      "-sample_fmt", "s16",     // 16-bit signed
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", // EBU R128 normalization
      "-f", "wav",
      outputPath,
    ]);
    
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      console.log(`[demucs] Normalized audio: ${inputPath} -> ${outputPath}`);
      return true;
    }
  } catch (e) {
    console.error("[demucs] Normalization failed:", e);
  }
  
  return false;
}

async function transcodeToM4A(
  inputWav: string,
  outM4a: string
): Promise<boolean> {
  const ffmpeg = resolveFfmpeg();
  try {
    await runProc(ffmpeg, ["-version"]);
  } catch {
    return false;
  }
  
  try {
    await runProc(ffmpeg, [
      "-y",
      "-i", inputWav,
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart", // Optimize for streaming
      outM4a,
    ]);
    return fs.existsSync(outM4a) && fs.statSync(outM4a).size > 0;
  } catch (e) {
    console.error("[demucs] Transcode to M4A failed:", e);
    return false;
  }
}

async function runDemucs(
  canonicalInputPath: string,
  onProgress: (p: number) => Promise<void>
) {
  const PYTHON_BIN =
    process.env.PYTHON_BIN ||
    path.join(process.env.HOME || "", "demucs_env", "bin", "python3");
  const MODULE_NAME = "demucs";

  // htdemucs_6s is a Transformer model with max segment of 7.8 seconds
  // Use smaller segment to stay within limits
  const args = [
    "-m", MODULE_NAME,
    "-d", "cpu",
    "-n", model,
    "-j", String(CPU_THREADS),
    "--overlap", "0.25",
    "--segment", "7",  // Max for htdemucs_6s is 7.8, use 7 to be safe
    "-o", SEPARATED_DIR,
    canonicalInputPath,
  ];

  await onProgress(1);

  await new Promise<void>((resolve, reject) => {
    if (!fs.existsSync(PYTHON_BIN)) {
      return reject(new Error(`Demucs python not found at ${PYTHON_BIN}`));
    }
    
    console.log(`[demucs] Starting separation with ${CPU_THREADS} threads...`);
    console.log(`[demucs] Command: ${PYTHON_BIN} ${args.join(" ")}`);
    
    const proc = spawn(PYTHON_BIN, args, { 
      cwd: ROOT, 
      env: {
        ...process.env,
        OMP_NUM_THREADS: String(CPU_THREADS),
        MKL_NUM_THREADS: String(CPU_THREADS),
        OPENBLAS_NUM_THREADS: String(CPU_THREADS),
      }
    });

    let lastPct = -1;
    
    proc.stdout.on("data", (buf: Buffer) => {
      console.log("[demucs stdout]", buf.toString());
    });
    
    proc.stderr.on("data", async (buf: Buffer) => {
      const text = buf.toString();
      const m = text.match(/(\d{1,3})%/);
      if (m) {
        const pct = Number(m[1]);
        if (!Number.isNaN(pct) && pct !== lastPct) {
          lastPct = pct;
          await onProgress(pct);
        }
      }
      if (text.trim()) {
        console.log("[demucs stderr]", text.trim());
      }
    });

    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Demucs exited ${code}`))
    );
  });
}

/**
 * Create a combined instrumental track from non-vocal stems
 * This provides backward compatibility with 2-stem apps
 */
async function createInstrumentalMix(sepDir: string): Promise<string | null> {
  const ffmpeg = resolveFfmpeg();
  const instrumentalPath = path.join(sepDir, "instrumental.m4a");
  
  // Find all non-vocal stem files
  const nonVocalStems: string[] = [];
  for (const stem of ["drums", "bass", "guitar", "piano", "other"]) {
    const m4aPath = path.join(sepDir, `${stem}.m4a`);
    const wavPath = path.join(sepDir, `${stem}.wav`);
    if (fs.existsSync(m4aPath)) {
      nonVocalStems.push(m4aPath);
    } else if (fs.existsSync(wavPath)) {
      nonVocalStems.push(wavPath);
    }
  }
  
  if (nonVocalStems.length === 0) return null;
  
  try {
    // Use FFmpeg to mix all non-vocal stems into one instrumental track
    const inputs: string[] = [];
    nonVocalStems.forEach((stem) => {
      inputs.push("-i", stem);
    });
    
    // Create amix filter for combining audio streams
    const filterComplex = `amix=inputs=${nonVocalStems.length}:duration=longest:normalize=0`;
    
    await runProc(ffmpeg, [
      "-y",
      ...inputs,
      "-filter_complex", filterComplex,
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      instrumentalPath,
    ]);
    
    if (fs.existsSync(instrumentalPath) && fs.statSync(instrumentalPath).size > 0) {
      console.log("[demucs] Created instrumental mix:", instrumentalPath);
      return instrumentalPath;
    }
  } catch (e) {
    console.error("[demucs] Failed to create instrumental mix:", e);
  }
  
  return null;
}

export const demucsWorker = new Worker(
  "demucs",
  async (job: Job) => {
    console.log("[demucs] ========== JOB STARTED ==========");
    console.log("[demucs] Job ID:", job.id);
    console.log("[demucs] Job data:", JSON.stringify(job.data));
    
    const { inputPath, basename } = job.data as {
      inputPath: string;
      basename: string;
    };

    console.log("[demucs] Input path:", inputPath);
    console.log("[demucs] Basename:", basename);
    console.log("[demucs] Input exists:", fs.existsSync(inputPath));

    const srcExt = path.extname(inputPath) || ".mp3";
    const canonicalInput = path.join(
      path.dirname(inputPath),
      `${basename}${srcExt}`
    );

    console.log("[demucs] Canonical input:", canonicalInput);

    try {
      if (canonicalInput !== inputPath) {
        console.log("[demucs] Copying to canonical path...");
        fs.copyFileSync(inputPath, canonicalInput);
      }
    } catch (e) {
      console.error("[demucs] Failed to prepare input:", e);
      throw new Error(`Failed to prepare input file: ${(e as Error).message}`);
    }

    // Phase 1: Normalize audio for quality
    const normalizedPath = path.join(NORMALIZED_DIR, `${basename}_normalized.wav`);
    let processInput = canonicalInput;
    
    console.log("[demucs] Starting normalization...");
    const normalized = await normalizeAudio(canonicalInput, normalizedPath);
    if (normalized) {
      processInput = normalizedPath;
      console.log("[demucs] ✓ Normalized audio ready:", normalizedPath);
    } else {
      console.log("[demucs] ✗ Normalization skipped, using original");
    }

    // Phase 2: Run Demucs separation
    console.log("[demucs] Starting Demucs separation...");
    console.log("[demucs] Process input:", processInput);
    console.log("[demucs] Process input exists:", fs.existsSync(processInput));
    
    await runDemucs(processInput, async (p) => {
      console.log(`[demucs] Progress: ${p}%`);
      await job.updateProgress(p);
    });

    console.log("[demucs] Demucs separation finished!");

    // Determine the actual output directory
    let sepDir = path.join(SEPARATED_DIR, model, normalized ? `${basename}_normalized` : basename);
    console.log("[demucs] Looking for output at:", sepDir);
    
    // Fallback: check without _normalized suffix
    if (!fs.existsSync(sepDir)) {
      sepDir = path.join(SEPARATED_DIR, model, basename);
      console.log("[demucs] Fallback 1:", sepDir, "exists:", fs.existsSync(sepDir));
    }
    
    // If still not found, try to find any matching directory
    if (!fs.existsSync(sepDir)) {
      const modelDir = path.join(SEPARATED_DIR, model);
      console.log("[demucs] Checking model dir:", modelDir, "exists:", fs.existsSync(modelDir));
      if (fs.existsSync(modelDir)) {
        const dirs = fs.readdirSync(modelDir);
        console.log("[demucs] Directories in model folder:", dirs);
        const match = dirs.find(d => d.includes(basename));
        if (match) {
          sepDir = path.join(modelDir, match);
          console.log("[demucs] Found match:", sepDir);
        }
      }
    }
    
    console.log("[demucs] Final output directory:", sepDir);
    console.log("[demucs] Output exists:", fs.existsSync(sepDir));
    
    if (fs.existsSync(sepDir)) {
      console.log("[demucs] Output contents:", fs.readdirSync(sepDir));
    }

    const stemBase = `/separated/${model}/${path.basename(sepDir)}`;

    // Process all 6 stems - transcode to M4A for smaller file size
    const stemUrls: Record<string, string | undefined> = {};
    
    for (const stem of ALL_STEMS) {
      const wavPath = path.join(sepDir, `${stem}.wav`);
      const m4aPath = path.join(sepDir, `${stem}.m4a`);
      
      let url: string | undefined = undefined;
      
      try {
        if (fs.existsSync(wavPath)) {
          console.log(`[demucs] Found ${stem}.wav, transcoding to m4a...`);
          const ok = await transcodeToM4A(wavPath, m4aPath);
          if (ok) {
            url = `${stemBase}/${stem}.m4a`;
            try {
              fs.unlinkSync(wavPath);
            } catch {}
          } else {
            // Transcode failed, use WAV
            url = `${stemBase}/${stem}.wav`;
          }
        } else if (fs.existsSync(m4aPath)) {
          url = `${stemBase}/${stem}.m4a`;
        } else {
          console.warn(`[demucs] ⚠ Stem file not found: ${stem} (checked ${wavPath} and ${m4aPath})`);
        }
      } catch (e) {
        console.error(`[demucs] Failed to process ${stem}:`, e);
      }
      
      // Only set URL if file actually exists
      if (url) {
        stemUrls[`${stem}Url`] = url;
      }
    }

    // Log which stems were found
    const foundStems = Object.keys(stemUrls).map(k => k.replace('Url', ''));
    console.log(`[demucs] Found ${foundStems.length}/6 stems:`, foundStems);

    // CRITICAL: Validate that at least vocals were generated
    if (!stemUrls.vocalsUrl) {
      const errorMsg = `Demucs separation failed: No stem files found in ${sepDir}. ` +
        `Check if htdemucs_6s model is installed and Demucs ran successfully.`;
      console.error(`[demucs] ✗ ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Create combined instrumental for backward compatibility
    console.log("[demucs] Creating instrumental mix...");
    const instrumentalPath = await createInstrumentalMix(sepDir);
    const instrumentalUrl = instrumentalPath 
      ? `${stemBase}/instrumental.m4a`
      : stemUrls.otherUrl;

    // Cleanup temporary files
    try { fs.unlinkSync(inputPath); } catch {}
    if (canonicalInput !== inputPath) {
      try { fs.unlinkSync(canonicalInput); } catch {}
    }
    if (normalized) {
      try { fs.unlinkSync(normalizedPath); } catch {}
    }

    const result: Result = {
      vocalsUrl: stemUrls.vocalsUrl!,
      drumsUrl: stemUrls.drumsUrl!,
      bassUrl: stemUrls.bassUrl!,
      guitarUrl: stemUrls.guitarUrl!,
      pianoUrl: stemUrls.pianoUrl!,
      otherUrl: stemUrls.otherUrl!,
      accompanimentUrl: instrumentalUrl!,
      instrumentalUrl: instrumentalUrl!,
      sepDir,
    };
    
    console.log("[demucs] ========== JOB COMPLETE ==========");
    console.log("[demucs] Result:", JSON.stringify(result, null, 2));
    return result;
  },
  { connection: Redis, concurrency: 1 }
);

// Add ALL worker event listeners for debugging
demucsWorker.on("completed", (job) =>
  console.log("[demucs] ✓ COMPLETED job:", job.id)
);
demucsWorker.on("failed", (job, err) =>
  console.error("[demucs] ✗ FAILED job:", job?.id, "error:", err.message)
);
demucsWorker.on("active", (job) =>
  console.log("[demucs] → ACTIVE job:", job.id)
);
demucsWorker.on("error", (err) =>
  console.error("[demucs] ✗ WORKER ERROR:", err)
);
demucsWorker.on("stalled", (jobId) =>
  console.warn("[demucs] ⚠ STALLED job:", jobId)
);
demucsWorker.on("ready", () =>
  console.log("[demucs] ✓ Worker READY and listening for jobs")
);

console.log("[demucs] Worker module loaded, connecting to Redis...");
