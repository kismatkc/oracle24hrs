// app/music/workers/demucs.worker.ts
// Oracle CPU Demucs Worker - High Quality Configuration
// Shifts: 10, Overlap: 0.25, Output: 320kbps MP3
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
const ALL_STEMS = [
    "vocals",
    "drums",
    "bass",
    "guitar",
    "piano",
    "other",
];
const model = process.env.DEMUCS_MODEL || "htdemucs_6s";
// ============================================================
// STANDARDIZED QUALITY CONFIGURATION - MAXIMUM QUALITY
// Matches Mac FastAPI settings for consistent output
// ============================================================
// Model: htdemucs_6s = 6 stems (vocals, drums, bass, guitar, piano, other)
// Shifts: 10 = maximum quality (shift trick averages multiple predictions)
// Overlap: 0.25 = default, good quality at segment boundaries
// Clip Mode: rescale = avoids clipping artifacts (default)
// MP3 Bitrate: 320k = maximum quality
// Note: No GPU settings - Oracle runs on CPU only
// ============================================================
const DEMUCS_CONFIG = {
    shifts: 10, // Max quality - averages 10 shifted predictions
    overlap: 0.25, // Default overlap between segments
    clipMode: "rescale",
    segment: 7, // Segment length in seconds
};
const AUDIO_CONFIG = {
    stemBitrate: "320k", // Maximum MP3 bitrate
    outputFormat: "mp3",
};
const CPU_THREADS = parseInt(process.env.DEMUCS_THREADS || "4", 10);
const THREE_DAYS_MS = 1000 * 60 * 60 * 24 * 3;
console.log("[demucs-oracle] ========== QUALITY CONFIG ==========");
console.log("[demucs-oracle] Model:", model);
console.log("[demucs-oracle] Shifts:", DEMUCS_CONFIG.shifts);
console.log("[demucs-oracle] Overlap:", DEMUCS_CONFIG.overlap);
console.log("[demucs-oracle] Output:", AUDIO_CONFIG.stemBitrate, AUDIO_CONFIG.outputFormat);
console.log("[demucs-oracle] ====================================");
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
function runProc(cmd, args) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args);
        let stdout = "", stderr = "";
        p.stdout?.on("data", (d) => (stdout += d.toString()));
        p.stderr?.on("data", (d) => (stderr += d.toString()));
        p.on("error", reject);
        p.on("close", (code) => code === 0
            ? resolve({ stdout, stderr })
            : reject(new Error(`${cmd} exited ${code}: ${stderr}`)));
    });
}
async function normalizeAudio(inputPath, outputPath) {
    const ffmpeg = resolveFfmpeg();
    try {
        await runProc(ffmpeg, [
            "-y",
            "-i",
            inputPath,
            "-ar",
            "44100",
            "-ac",
            "2",
            "-sample_fmt",
            "s16",
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-f",
            "wav",
            outputPath,
        ]);
        return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
    }
    catch {
        return false;
    }
}
async function transcodeToMp3(inputWav, outMp3) {
    const ffmpeg = resolveFfmpeg();
    try {
        await runProc(ffmpeg, [
            "-y",
            "-i",
            inputWav,
            "-c:a",
            "libmp3lame",
            "-b:a",
            AUDIO_CONFIG.stemBitrate,
            "-q:a",
            "0",
            outMp3,
        ]);
        return fs.existsSync(outMp3) && fs.statSync(outMp3).size > 0;
    }
    catch {
        return false;
    }
}
async function runDemucs(inputPath, onProgress) {
    const PYTHON_BIN = process.env.PYTHON_BIN ||
        path.join(process.env.HOME || "", "demucs_env", "bin", "python3");
    const args = [
        "-m",
        "demucs",
        "-d",
        "cpu",
        "-n",
        model,
        "-j",
        String(CPU_THREADS),
        "--shifts",
        String(DEMUCS_CONFIG.shifts),
        "--overlap",
        String(DEMUCS_CONFIG.overlap),
        "--clip-mode",
        DEMUCS_CONFIG.clipMode,
        "--segment",
        String(DEMUCS_CONFIG.segment),
        "-o",
        SEPARATED_DIR,
        inputPath,
    ];
    await onProgress(1);
    await new Promise((resolve, reject) => {
        if (!fs.existsSync(PYTHON_BIN))
            return reject(new Error(`Python not found: ${PYTHON_BIN}`));
        const proc = spawn(PYTHON_BIN, args, {
            cwd: ROOT,
            env: {
                ...process.env,
                OMP_NUM_THREADS: String(CPU_THREADS),
                CUDA_VISIBLE_DEVICES: "",
            },
        });
        let lastPct = -1;
        proc.stderr.on("data", async (buf) => {
            const m = buf.toString().match(/(\d{1,3})%/);
            if (m) {
                const pct = Number(m[1]);
                if (pct !== lastPct) {
                    lastPct = pct;
                    await onProgress(pct);
                }
            }
        });
        proc.on("error", reject);
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Demucs exited ${code}`)));
    });
}
async function createInstrumentalMix(sepDir) {
    const ffmpeg = resolveFfmpeg();
    const outPath = path.join(sepDir, "instrumental.mp3");
    const stems = [];
    for (const s of ["drums", "bass", "guitar", "piano", "other"]) {
        const mp3 = path.join(sepDir, `${s}.mp3`);
        const wav = path.join(sepDir, `${s}.wav`);
        if (fs.existsSync(mp3))
            stems.push(mp3);
        else if (fs.existsSync(wav))
            stems.push(wav);
    }
    if (stems.length === 0)
        return null;
    try {
        const inputs = [];
        stems.forEach((s) => inputs.push("-i", s));
        await runProc(ffmpeg, [
            "-y",
            ...inputs,
            "-filter_complex",
            `amix=inputs=${stems.length}:duration=longest:normalize=0`,
            "-c:a",
            "libmp3lame",
            "-b:a",
            AUDIO_CONFIG.stemBitrate,
            outPath,
        ]);
        return fs.existsSync(outPath) ? outPath : null;
    }
    catch {
        return null;
    }
}
export const demucsWorker = new Worker("demucs", async (job) => {
    console.log("[demucs-oracle] Job started:", job.id);
    const { inputPath, basename } = job.data;
    const srcExt = path.extname(inputPath) || ".mp3";
    const canonicalInput = path.join(path.dirname(inputPath), `${basename}${srcExt}`);
    if (canonicalInput !== inputPath)
        fs.copyFileSync(inputPath, canonicalInput);
    // Normalize
    const normalizedPath = path.join(NORMALIZED_DIR, `${basename}_normalized.wav`);
    let processInput = canonicalInput;
    if (await normalizeAudio(canonicalInput, normalizedPath))
        processInput = normalizedPath;
    // Run Demucs
    await runDemucs(processInput, async (p) => await job.updateProgress(p));
    // Find output
    const baseName = path.basename(processInput, path.extname(processInput));
    let sepDir = path.join(SEPARATED_DIR, model, baseName);
    if (!fs.existsSync(sepDir))
        sepDir = path.join(SEPARATED_DIR, model, basename);
    const stemBase = `/separated/${model}/${path.basename(sepDir)}`;
    const stemUrls = {};
    // Transcode to MP3
    for (const stem of ALL_STEMS) {
        const wav = path.join(sepDir, `${stem}.wav`);
        const mp3 = path.join(sepDir, `${stem}.mp3`);
        if (fs.existsSync(wav)) {
            if (await transcodeToMp3(wav, mp3)) {
                stemUrls[`${stem}Url`] = `${stemBase}/${stem}.mp3`;
                try {
                    fs.unlinkSync(wav);
                }
                catch { }
            }
            else {
                stemUrls[`${stem}Url`] = `${stemBase}/${stem}.wav`;
            }
        }
        else if (fs.existsSync(mp3)) {
            stemUrls[`${stem}Url`] = `${stemBase}/${stem}.mp3`;
        }
    }
    if (!stemUrls.vocalsUrl)
        throw new Error("No stems found");
    const instrumentalPath = await createInstrumentalMix(sepDir);
    const instrumentalUrl = instrumentalPath
        ? `${stemBase}/instrumental.mp3`
        : stemUrls.otherUrl;
    // Cleanup
    try {
        fs.unlinkSync(inputPath);
    }
    catch { }
    if (canonicalInput !== inputPath)
        try {
            fs.unlinkSync(canonicalInput);
        }
        catch { }
    try {
        fs.unlinkSync(normalizedPath);
    }
    catch { }
    console.log("[demucs-oracle] Job complete:", job.id);
    return {
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
}, { connection: Redis, concurrency: 1 });
demucsWorker.on("completed", (job) => console.log("[demucs-oracle] ✓", job.id));
demucsWorker.on("failed", (job, err) => console.error("[demucs-oracle] ✗", job?.id, err.message));
demucsWorker.on("ready", () => console.log("[demucs-oracle] Worker ready"));
// NOTE: 72-hour purge is handled by upload-music.ts controller
// Removed duplicate purge here to prevent file access conflicts
console.log("[demucs-oracle] Module loaded");
