// app/music/workers/demucs.worker.ts
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { Worker } from "bullmq";
import { BullRedis as Redis } from "../../../lib/bullRedis.js";
const ROOT = process.cwd();
const SEPARATED_DIR = path.join(ROOT, "separated");
const NORMALIZED_DIR = path.join(ROOT, "normalized");
fs.mkdirSync(SEPARATED_DIR, { recursive: true });
fs.mkdirSync(NORMALIZED_DIR, { recursive: true });
const ALL_STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"];
// Use htdemucs_6s for 6-stem separation (vocals, drums, bass, guitar, piano, other)
const model = process.env.DEMUCS_MODEL || "htdemucs_6s";
// ============================================================
// HIGH QUALITY CONFIGURATION
// Priority: Maximum extraction quality over speed
// Expected processing time: 10-20 minutes per song on Oracle A1.Flex
// ============================================================
// CPU thread optimization for Oracle Ampere A1 (4 vCPU)
const CPU_THREADS = parseInt(process.env.DEMUCS_THREADS || "4", 10);
// High-quality Demucs settings
const DEMUCS_CONFIG = {
    // --shifts: Number of random shifts for augmentation averaging
    // Higher = fewer artifacts, slower processing
    // Default: 1, Max quality: 10-20
    shifts: parseInt(process.env.DEMUCS_SHIFTS || "20", 10),
    // --overlap: Overlap between chunks (0.0 to 0.99)
    // Higher = smoother transitions, more memory usage
    // Default: 0.25, Max quality: 0.5-0.75
    overlap: parseFloat(process.env.DEMUCS_OVERLAP || "0.5"),
    // --clip-mode: How to handle clipping in output
    // "rescale" = scale down to prevent clipping (recommended)
    // "clamp" = hard clip (can cause distortion)
    // "none" = allow clipping
    clipMode: process.env.DEMUCS_CLIP_MODE || "rescale",
    // --segment: Segment length in seconds
    // htdemucs_6s max is 7.8, use 7 to be safe
    segment: 7,
};
// High-quality audio encoding settings
const AUDIO_CONFIG = {
    // M4A/AAC bitrate for stems (kbps)
    // 192k = good, 256k = very good, 320k = near-lossless
    stemBitrate: process.env.STEM_BITRATE || "320k",
    // Keep original WAV files as backup (true/false)
    keepWav: process.env.KEEP_WAV === "true",
};
console.log("[demucs] ========== HIGH QUALITY CONFIG ==========");
console.log("[demucs] Model:", model);
console.log("[demucs] Shifts:", DEMUCS_CONFIG.shifts, "(default: 1, using 20 for max quality)");
console.log("[demucs] Overlap:", DEMUCS_CONFIG.overlap, "(default: 0.25, using 0.5 for smoother transitions)");
console.log("[demucs] Clip Mode:", DEMUCS_CONFIG.clipMode, "(rescale prevents distortion)");
console.log("[demucs] Segment:", DEMUCS_CONFIG.segment, "seconds");
console.log("[demucs] Stem Bitrate:", AUDIO_CONFIG.stemBitrate, "(320k for near-lossless)");
console.log("[demucs] CPU Threads:", CPU_THREADS);
console.log("[demucs] ==========================================");
function resolveFfmpeg() {
    if (process.env.FFMPEG_BIN)
        return process.env.FFMPEG_BIN;
    try {
        const inst = require("@ffmpeg-installer/ffmpeg");
        if (inst?.path)
            return inst.path;
    }
    catch { }
    return "ffmpeg";
}
function runProc(cmd, args, cwd, env) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { cwd, env });
        let stdout = "";
        let stderr = "";
        p.stdout?.on("data", (d) => (stdout += d.toString()));
        p.stderr?.on("data", (d) => (stderr += d.toString()));
        p.on("error", reject);
        p.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}: ${stderr}`)));
    });
}
/**
 * FFmpeg Normalization Pre-processing (HIGH QUALITY)
 * Converts input to 44.1kHz, 16-bit WAV for optimal Demucs processing
 * Uses EBU R128 loudness normalization to ensure consistent input levels
 */
async function normalizeAudio(inputPath, outputPath) {
    const ffmpeg = resolveFfmpeg();
    try {
        await runProc(ffmpeg, ["-version"]);
    }
    catch {
        console.warn("[demucs] FFmpeg not available, skipping normalization");
        return false;
    }
    try {
        console.log("[demucs] Normalizing audio to 44.1kHz/16-bit WAV with EBU R128...");
        // High-quality normalization pipeline:
        // 1. Resample to 44.1kHz (CD quality, Demucs training rate)
        // 2. Convert to 16-bit signed PCM (optimal for Demucs)
        // 3. Apply EBU R128 loudness normalization
        //    - I=-16 LUFS (integrated loudness target)
        //    - TP=-1.5 dBTP (true peak limit, prevents clipping)
        //    - LRA=11 (loudness range target)
        await runProc(ffmpeg, [
            "-y",
            "-i", inputPath,
            "-ar", "44100", // 44.1kHz sample rate (CD quality)
            "-ac", "2", // Stereo
            "-sample_fmt", "s16", // 16-bit signed PCM
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-16:measured_TP=-1.5:measured_LRA=11:measured_thresh=-26:offset=0:linear=true:print_format=summary",
            "-f", "wav",
            outputPath,
        ]);
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            const stats = fs.statSync(outputPath);
            console.log(`[demucs] ✓ Normalized audio: ${inputPath} -> ${outputPath} (${Math.round(stats.size / 1024 / 1024)}MB)`);
            return true;
        }
    }
    catch (e) {
        console.error("[demucs] Normalization failed:", e);
    }
    return false;
}
/**
 * Transcode WAV to M4A with HIGH QUALITY settings
 * Uses AAC codec at 320kbps for near-lossless compression
 */
async function transcodeToM4A(inputWav, outM4a) {
    const ffmpeg = resolveFfmpeg();
    try {
        await runProc(ffmpeg, ["-version"]);
    }
    catch {
        return false;
    }
    try {
        console.log(`[demucs] Transcoding to M4A @ ${AUDIO_CONFIG.stemBitrate}...`);
        await runProc(ffmpeg, [
            "-y",
            "-i", inputWav,
            "-c:a", "aac",
            "-b:a", AUDIO_CONFIG.stemBitrate, // 320k for high quality
            "-movflags", "+faststart", // Optimize for streaming
            "-profile:a", "aac_low", // AAC-LC profile (best compatibility)
            outM4a,
        ]);
        return fs.existsSync(outM4a) && fs.statSync(outM4a).size > 0;
    }
    catch (e) {
        console.error("[demucs] Transcode to M4A failed:", e);
        return false;
    }
}
/**
 * Run Demucs with HIGH QUALITY configuration
 * Uses --shifts=20, --overlap=0.5, --clip-mode=rescale for maximum quality
 * Expected time: 10-20 minutes per song on 4-core ARM64
 */
async function runDemucs(canonicalInputPath, onProgress) {
    const PYTHON_BIN = process.env.PYTHON_BIN ||
        path.join(process.env.HOME || "", "demucs_env", "bin", "python3");
    const MODULE_NAME = "demucs";
    // HIGH QUALITY Demucs arguments
    const args = [
        "-m", MODULE_NAME,
        "-d", "cpu",
        "-n", model,
        "-j", String(CPU_THREADS),
        // HIGH QUALITY FLAGS
        "--shifts", String(DEMUCS_CONFIG.shifts), // 20 random shifts for artifact reduction
        "--overlap", String(DEMUCS_CONFIG.overlap), // 0.5 overlap for smooth transitions
        "--clip-mode", DEMUCS_CONFIG.clipMode, // rescale to prevent clipping
        "--segment", String(DEMUCS_CONFIG.segment), // 7 seconds (max for htdemucs_6s is 7.8)
        "-o", SEPARATED_DIR,
        canonicalInputPath,
    ];
    await onProgress(1);
    console.log("[demucs] ========== STARTING HIGH QUALITY SEPARATION ==========");
    console.log("[demucs] This will take 10-20 minutes for maximum quality...");
    console.log("[demucs] Command:", PYTHON_BIN, args.join(" "));
    await new Promise((resolve, reject) => {
        if (!fs.existsSync(PYTHON_BIN)) {
            return reject(new Error(`Demucs python not found at ${PYTHON_BIN}`));
        }
        const startTime = Date.now();
        const proc = spawn(PYTHON_BIN, args, {
            cwd: ROOT,
            env: {
                ...process.env,
                // Optimize CPU threading for quality
                OMP_NUM_THREADS: String(CPU_THREADS),
                MKL_NUM_THREADS: String(CPU_THREADS),
                OPENBLAS_NUM_THREADS: String(CPU_THREADS),
                // Disable GPU (CPU-only for Oracle A1)
                CUDA_VISIBLE_DEVICES: "",
            }
        });
        let lastPct = -1;
        proc.stdout.on("data", (buf) => {
            console.log("[demucs stdout]", buf.toString());
        });
        proc.stderr.on("data", async (buf) => {
            const text = buf.toString();
            const m = text.match(/(\d{1,3})%/);
            if (m) {
                const pct = Number(m[1]);
                if (!Number.isNaN(pct) && pct !== lastPct) {
                    lastPct = pct;
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    console.log(`[demucs] Progress: ${pct}% (${elapsed}s elapsed)`);
                    await onProgress(pct);
                }
            }
            if (text.trim()) {
                console.log("[demucs stderr]", text.trim());
            }
        });
        proc.on("error", reject);
        proc.on("close", (code) => {
            const totalTime = Math.round((Date.now() - startTime) / 1000);
            if (code === 0) {
                console.log(`[demucs] ✓ Separation completed in ${totalTime} seconds`);
                resolve();
            }
            else {
                reject(new Error(`Demucs exited ${code} after ${totalTime}s`));
            }
        });
    });
}
/**
 * Create a combined instrumental track from non-vocal stems
 * Uses HIGH QUALITY bitrate for the mix
 */
async function createInstrumentalMix(sepDir) {
    const ffmpeg = resolveFfmpeg();
    const instrumentalPath = path.join(sepDir, "instrumental.m4a");
    // Find all non-vocal stem files
    const nonVocalStems = [];
    for (const stem of ["drums", "bass", "guitar", "piano", "other"]) {
        const m4aPath = path.join(sepDir, `${stem}.m4a`);
        const wavPath = path.join(sepDir, `${stem}.wav`);
        if (fs.existsSync(m4aPath)) {
            nonVocalStems.push(m4aPath);
        }
        else if (fs.existsSync(wavPath)) {
            nonVocalStems.push(wavPath);
        }
    }
    if (nonVocalStems.length === 0)
        return null;
    try {
        console.log(`[demucs] Creating instrumental mix from ${nonVocalStems.length} stems @ ${AUDIO_CONFIG.stemBitrate}...`);
        // Use FFmpeg to mix all non-vocal stems into one instrumental track
        const inputs = [];
        nonVocalStems.forEach((stem) => {
            inputs.push("-i", stem);
        });
        // Create amix filter for combining audio streams
        // normalize=0 preserves original levels (no auto-normalization)
        const filterComplex = `amix=inputs=${nonVocalStems.length}:duration=longest:normalize=0`;
        await runProc(ffmpeg, [
            "-y",
            ...inputs,
            "-filter_complex", filterComplex,
            "-c:a", "aac",
            "-b:a", AUDIO_CONFIG.stemBitrate, // 320k for high quality
            "-movflags", "+faststart",
            "-profile:a", "aac_low",
            instrumentalPath,
        ]);
        if (fs.existsSync(instrumentalPath) && fs.statSync(instrumentalPath).size > 0) {
            console.log("[demucs] ✓ Created instrumental mix:", instrumentalPath);
            return instrumentalPath;
        }
    }
    catch (e) {
        console.error("[demucs] Failed to create instrumental mix:", e);
    }
    return null;
}
export const demucsWorker = new Worker("demucs", async (job) => {
    console.log("[demucs] ========== JOB STARTED (HIGH QUALITY MODE) ==========");
    console.log("[demucs] Job ID:", job.id);
    console.log("[demucs] Job data:", JSON.stringify(job.data));
    console.log("[demucs] Quality settings: shifts=%d, overlap=%s, clip-mode=%s, bitrate=%s", DEMUCS_CONFIG.shifts, DEMUCS_CONFIG.overlap, DEMUCS_CONFIG.clipMode, AUDIO_CONFIG.stemBitrate);
    const { inputPath, basename } = job.data;
    console.log("[demucs] Input path:", inputPath);
    console.log("[demucs] Basename:", basename);
    console.log("[demucs] Input exists:", fs.existsSync(inputPath));
    const srcExt = path.extname(inputPath) || ".mp3";
    const canonicalInput = path.join(path.dirname(inputPath), `${basename}${srcExt}`);
    console.log("[demucs] Canonical input:", canonicalInput);
    try {
        if (canonicalInput !== inputPath) {
            console.log("[demucs] Copying to canonical path...");
            fs.copyFileSync(inputPath, canonicalInput);
        }
    }
    catch (e) {
        console.error("[demucs] Failed to prepare input:", e);
        throw new Error(`Failed to prepare input file: ${e.message}`);
    }
    // Phase 1: Normalize audio for quality
    const normalizedPath = path.join(NORMALIZED_DIR, `${basename}_normalized.wav`);
    let processInput = canonicalInput;
    console.log("[demucs] Phase 1: Audio normalization (44.1kHz/16-bit WAV)...");
    const normalized = await normalizeAudio(canonicalInput, normalizedPath);
    if (normalized) {
        processInput = normalizedPath;
        console.log("[demucs] ✓ Phase 1 complete: Normalized audio ready");
    }
    else {
        console.log("[demucs] ⚠ Phase 1 skipped: Using original file");
    }
    // Phase 2: Run Demucs separation with HIGH QUALITY settings
    console.log("[demucs] Phase 2: Demucs separation (HIGH QUALITY - this takes 10-20 min)...");
    console.log("[demucs] Process input:", processInput);
    console.log("[demucs] Process input exists:", fs.existsSync(processInput));
    await runDemucs(processInput, async (p) => {
        await job.updateProgress(p);
    });
    console.log("[demucs] ✓ Phase 2 complete: Demucs separation finished!");
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
    // Phase 3: Transcode stems to M4A with HIGH QUALITY bitrate
    console.log("[demucs] Phase 3: Transcoding stems to M4A @ " + AUDIO_CONFIG.stemBitrate + "...");
    const stemUrls = {};
    for (const stem of ALL_STEMS) {
        const wavPath = path.join(sepDir, `${stem}.wav`);
        const m4aPath = path.join(sepDir, `${stem}.m4a`);
        let url = undefined;
        try {
            if (fs.existsSync(wavPath)) {
                console.log(`[demucs] Transcoding ${stem}.wav -> ${stem}.m4a @ ${AUDIO_CONFIG.stemBitrate}...`);
                const ok = await transcodeToM4A(wavPath, m4aPath);
                if (ok) {
                    url = `${stemBase}/${stem}.m4a`;
                    // Optionally keep WAV files for lossless storage
                    if (!AUDIO_CONFIG.keepWav) {
                        try {
                            fs.unlinkSync(wavPath);
                        }
                        catch { }
                    }
                }
                else {
                    // Transcode failed, use WAV (lossless fallback)
                    url = `${stemBase}/${stem}.wav`;
                    console.log(`[demucs] ⚠ Transcode failed for ${stem}, keeping WAV (lossless)`);
                }
            }
            else if (fs.existsSync(m4aPath)) {
                url = `${stemBase}/${stem}.m4a`;
            }
            else {
                console.warn(`[demucs] ⚠ Stem file not found: ${stem} (checked ${wavPath} and ${m4aPath})`);
            }
        }
        catch (e) {
            console.error(`[demucs] Failed to process ${stem}:`, e);
        }
        // Only set URL if file actually exists
        if (url) {
            stemUrls[`${stem}Url`] = url;
        }
    }
    // Log which stems were found
    const foundStems = Object.keys(stemUrls).map(k => k.replace('Url', ''));
    console.log(`[demucs] ✓ Phase 3 complete: ${foundStems.length}/6 stems transcoded:`, foundStems);
    // CRITICAL: Validate that at least vocals were generated
    if (!stemUrls.vocalsUrl) {
        const errorMsg = `Demucs separation failed: No stem files found in ${sepDir}. ` +
            `Check if htdemucs_6s model is installed and Demucs ran successfully.`;
        console.error(`[demucs] ✗ ${errorMsg}`);
        throw new Error(errorMsg);
    }
    // Phase 4: Create combined instrumental for backward compatibility
    console.log("[demucs] Phase 4: Creating instrumental mix...");
    const instrumentalPath = await createInstrumentalMix(sepDir);
    const instrumentalUrl = instrumentalPath
        ? `${stemBase}/instrumental.m4a`
        : stemUrls.otherUrl;
    // Cleanup temporary files
    try {
        fs.unlinkSync(inputPath);
    }
    catch { }
    if (canonicalInput !== inputPath) {
        try {
            fs.unlinkSync(canonicalInput);
        }
        catch { }
    }
    if (normalized) {
        try {
            fs.unlinkSync(normalizedPath);
        }
        catch { }
    }
    const result = {
        vocalsUrl: stemUrls.vocalsUrl,
        drumsUrl: stemUrls.drumsUrl,
        bassUrl: stemUrls.bassUrl,
        guitarUrl: stemUrls.guitarUrl,
        pianoUrl: stemUrls.pianoUrl,
        otherUrl: stemUrls.otherUrl,
        accompanimentUrl: instrumentalUrl,
        instrumentalUrl: instrumentalUrl,
        sepDir,
    };
    console.log("[demucs] ========== JOB COMPLETE (HIGH QUALITY) ==========");
    console.log("[demucs] Result:", JSON.stringify(result, null, 2));
    return result;
}, { connection: Redis, concurrency: 1 });
// Add ALL worker event listeners for debugging
demucsWorker.on("completed", (job) => console.log("[demucs] ✓ COMPLETED job:", job.id));
demucsWorker.on("failed", (job, err) => console.error("[demucs] ✗ FAILED job:", job?.id, "error:", err.message));
demucsWorker.on("active", (job) => console.log("[demucs] → ACTIVE job:", job.id));
demucsWorker.on("error", (err) => console.error("[demucs] ✗ WORKER ERROR:", err));
demucsWorker.on("stalled", (jobId) => console.warn("[demucs] ⚠ STALLED job:", jobId));
demucsWorker.on("ready", () => console.log("[demucs] ✓ Worker READY (HIGH QUALITY MODE) - shifts=%d, overlap=%s, bitrate=%s", DEMUCS_CONFIG.shifts, DEMUCS_CONFIG.overlap, AUDIO_CONFIG.stemBitrate));
console.log("[demucs] Worker module loaded (HIGH QUALITY MODE), connecting to Redis...");
