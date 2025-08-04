// import path from "path";
// import fs from "fs";
// import { spawn } from "child_process";
// import { Worker, Job } from "bullmq";
// import { BullRedis as Redis } from "../../../lib/bullRedis.js";
// const SEPARATED_DIR = path.join(process.cwd(), "separated");
// fs.mkdirSync(SEPARATED_DIR, { recursive: true });
// type Result = { vocalsUrl: string; accompanimentUrl: string };
// /**
//  * Runs Demucs via your existing virtualenv's python module,
//  * streams progress percentages, and returns stem URLs.
//  */
// async function runDemucs(
//   inputPath: string,
//   basename: string,
//   onProgress: (p: number) => Promise<void>
// ): Promise<Result> {
//   const model = "mdx_q";
//   // Path to python inside your venv (where Demucs is installed)
//   const PYTHON_BIN =
//     process.env.PYTHON_BIN ||
//     path.join(process.env.HOME || "", "demucs_env", "bin", "python3");
//   const MODULE_NAME = "demucs";
//   // Demucs CLI args (same as before)
//   const args = [
//     "-d",
//     "cpu",
//     "-n",
//     model,
//     "--two-stems=vocals",
//     "-j",
//     "1",
//     "--overlap",
//     "0",
//     inputPath,
//   ];
//   // Kick off with a small progress so UI moves
//   await onProgress(1);
//   return new Promise<Result>((resolve, reject) => {
//     if (!fs.existsSync(PYTHON_BIN)) {
//       return reject(new Error(`Demucs python not found at ${PYTHON_BIN}`));
//     }
//     // Spawn python3 -m demucs <args...>
//     const proc = spawn(PYTHON_BIN, ["-m", MODULE_NAME, ...args], {
//       cwd: process.cwd(),
//       env: process.env,
//     });
//     let lastPct = -1;
//     proc.stderr.on("data", async (buf: Buffer) => {
//       const m = buf.toString().match(/(\d{1,3})%/);
//       if (!m) return;
//       const pct = Number(m[1]);
//       if (!Number.isNaN(pct) && pct !== lastPct) {
//         lastPct = pct;
//         await onProgress(pct);
//       }
//     });
//     proc.on("error", (err) => reject(err));
//     proc.on("close", (code) => {
//       try {
//         fs.unlinkSync(inputPath);
//       } catch {}
//       if (code !== 0) {
//         return reject(new Error(`Demucs exited with code ${code}`));
//       }
//       const stemBase = `/separated/${model}/${basename}`;
//       resolve({
//         vocalsUrl: `${stemBase}/vocals.wav`,
//         accompanimentUrl: `${stemBase}/no_vocals.wav`,
//       });
//     });
//   });
// }
// // Worker that picks jobs from 'demucs' queue, runs runDemucs, and returns URLs
// export const demucsWorker = new Worker(
//   "demucs",
//   async (job: Job) => {
//     const { inputPath, basename } = job.data as {
//       inputPath: string;
//       basename: string;
//     };
//     const result = await runDemucs(inputPath, basename, async (p) =>
//       job.updateProgress(p)
//     );
//     return result;
//   },
//   {
//     connection: Redis,
//     concurrency: 1,
//   }
// );
// // Optional: logs
// demucsWorker.on("completed", (job) =>
//   console.log("[demucs] completed", job.id)
// );
// demucsWorker.on("failed", (job, err) =>
//   console.error("[demucs] failed", job?.id, err)
// );
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { Worker } from "bullmq";
import { BullRedis as Redis } from "../../../lib/bullRedis.js";
const SEPARATED_DIR = path.join(process.cwd(), "separated");
fs.mkdirSync(SEPARATED_DIR, { recursive: true });
/**
 * Runs Demucs via your venv's python module, streams progress, returns URLs + sepDir.
 */
async function runDemucs(inputPath, basename, onProgress) {
    const model = "mdx_q";
    const PYTHON_BIN = process.env.PYTHON_BIN ||
        path.join(process.env.HOME || "", "demucs_env", "bin", "python3");
    const MODULE_NAME = "demucs";
    const args = [
        "-d",
        "cpu",
        "-n",
        model,
        "--two-stems=vocals",
        "-j",
        "1",
        "--overlap",
        "0",
        inputPath,
    ];
    await onProgress(1);
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(PYTHON_BIN)) {
            return reject(new Error(`Demucs python not found at ${PYTHON_BIN}`));
        }
        const proc = spawn(PYTHON_BIN, ["-m", MODULE_NAME, ...args], {
            cwd: process.cwd(),
            env: process.env,
        });
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
        proc.on("error", (err) => reject(err));
        proc.on("close", (code) => {
            // remove uploaded file immediately
            try {
                fs.unlinkSync(inputPath);
            }
            catch { }
            if (code !== 0) {
                return reject(new Error(`Demucs exited with code ${code}`));
            }
            const sepDir = path.join(SEPARATED_DIR, model, basename);
            const stemBase = `/separated/${model}/${basename}`;
            resolve({
                vocalsUrl: `${stemBase}/vocals.wav`,
                accompanimentUrl: `${stemBase}/no_vocals.wav`,
                sepDir, // absolute, for cleanup endpoint
            });
        });
    });
}
// Worker that processes jobs and returns URLs + sepDir
export const demucsWorker = new Worker("demucs", async (job) => {
    const { inputPath, basename } = job.data;
    const result = await runDemucs(inputPath, basename, async (p) => job.updateProgress(p));
    return result;
}, {
    connection: Redis,
    concurrency: 1,
});
// Logs
demucsWorker.on("completed", (job) => console.log("[demucs] completed", job.id));
demucsWorker.on("failed", (job, err) => console.error("[demucs] failed", job?.id, err));
