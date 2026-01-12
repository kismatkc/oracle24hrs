import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { Worker } from "bullmq";
import { BullRedis as Redis } from "../../../lib/bullRedis.js";
const ROOT = process.cwd();
const SEPARATED_DIR = path.join(ROOT, "separated");
fs.mkdirSync(SEPARATED_DIR, { recursive: true });
const model = "mdx_q";
/* resolve ffmpeg if present */
function resolveFfmpeg() {
    if (process.env.FFMPEG_BIN)
        return process.env.FFMPEG_BIN;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const inst = require("@ffmpeg-installer/ffmpeg");
        if (inst?.path)
            return inst.path;
    }
    catch { }
    return "ffmpeg";
}
/** run a process and resolve/reject on exit */
function runProc(cmd, args, cwd, env) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { cwd, env });
        p.on("error", reject);
        p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    });
}
/** Transcode WAV -> M4A (AAC). If ffmpeg missing, returns false. */
async function transcodeToM4A(inputWav, outM4a) {
    const ffmpeg = resolveFfmpeg();
    try {
        await runProc(ffmpeg, ["-version"]);
    }
    catch {
        return false; // ffmpeg not available, keep WAV
    }
    await runProc(ffmpeg, ["-y", "-i", inputWav, "-c:a", "aac", "-b:a", "192k", outM4a]);
    return fs.existsSync(outM4a) && fs.statSync(outM4a).size > 0;
}
/** Run Demucs; force output into SEPARATED_DIR and stream % progress. */
async function runDemucs(canonicalInputPath, onProgress) {
    const PYTHON_BIN = process.env.PYTHON_BIN ||
        path.join(process.env.HOME || "", "demucs_env", "bin", "python3");
    const MODULE_NAME = "demucs";
    const args = [
        "-m",
        MODULE_NAME,
        "-d",
        "cpu",
        "-n",
        model,
        "--two-stems=vocals",
        "-j",
        "1",
        "--overlap",
        "0",
        "-o",
        SEPARATED_DIR, // <— force output root
        canonicalInputPath,
    ];
    await onProgress(1);
    await new Promise((resolve, reject) => {
        if (!fs.existsSync(PYTHON_BIN)) {
            return reject(new Error(`Demucs python not found at ${PYTHON_BIN}`));
        }
        const proc = spawn(PYTHON_BIN, args, { cwd: ROOT, env: process.env });
        let lastPct = -1;
        proc.stderr.on("data", async (buf) => {
            const m = buf.toString().match(/(\d{1,3})%/);
            if (!m)
                return;
            const pct = Number(m[1]);
            if (!Number.isNaN(pct) && pct !== lastPct) {
                lastPct = pct;
                await onProgress(pct);
            }
        });
        proc.on("error", reject);
        proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Demucs exited ${code}`))));
    });
}
/** Worker: copy upload → <basename>.<ext>, run demucs, transcode, return URLs */
export const demucsWorker = new Worker("demucs", async (job) => {
    const { inputPath, basename } = job.data;
    // Canonicalize the uploaded file name so demucs will output to <basename>/
    const srcExt = path.extname(inputPath) || ".mp3";
    const canonicalInput = path.join(path.dirname(inputPath), `${basename}${srcExt}`);
    try {
        if (canonicalInput !== inputPath) {
            fs.copyFileSync(inputPath, canonicalInput); // keep original around; we’ll clean up both
        }
    }
    catch (e) {
        throw new Error(`Failed to prepare input file: ${e.message}`);
    }
    await runDemucs(canonicalInput, async (p) => job.updateProgress(p));
    // demucs now outputs to: SEPARATED_DIR/<model>/<basename>/
    const sepDir = path.join(SEPARATED_DIR, model, basename);
    const stemBase = `/separated/${model}/${basename}`;
    const wavVocals = path.join(sepDir, "vocals.wav");
    const wavNoVoc = path.join(sepDir, "no_vocals.wav");
    const m4aVocals = path.join(sepDir, "vocals.m4a");
    const m4aNoVoc = path.join(sepDir, "no_vocals.m4a");
    let vocalsUrl = `${stemBase}/vocals.wav`;
    let accompUrl = `${stemBase}/no_vocals.wav`;
    try {
        // Transcode where possible, then delete the source WAV to avoid confusion
        if (fs.existsSync(wavVocals)) {
            const ok = await transcodeToM4A(wavVocals, m4aVocals);
            if (ok) {
                vocalsUrl = `${stemBase}/vocals.m4a`;
                try {
                    fs.unlinkSync(wavVocals);
                }
                catch { }
            }
        }
        if (fs.existsSync(wavNoVoc)) {
            const ok = await transcodeToM4A(wavNoVoc, m4aNoVoc);
            if (ok) {
                accompUrl = `${stemBase}/no_vocals.m4a`;
                try {
                    fs.unlinkSync(wavNoVoc);
                }
                catch { }
            }
        }
    }
    finally {
        // Clean original upload(s)
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
    }
    const result = { vocalsUrl, accompanimentUrl: accompUrl, sepDir };
    return result;
}, { connection: Redis, concurrency: 1 });
demucsWorker.on("completed", (job) => console.log("[demucs] completed", job.id));
demucsWorker.on("failed", (job, err) => console.error("[demucs] failed", job?.id, err));
