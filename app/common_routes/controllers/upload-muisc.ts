// src/server/routes/test-upload-music.ts
import express, { NextFunction, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

const router = express.Router();
const TEN_MIN = 10 * 60 * 1000; // 600 000 ms

function longTimeout(_req: Request, res: Response, next: NextFunction) {
  // Give Node 10 min of inactivity on the socket
  res.setTimeout(TEN_MIN);
  // If you also want to allow 10 min for the client to finish uploading:
  // _req.setTimeout(TEN_MIN);

  next();
}

// ──────────────────────────────────────────────
// Ensure folders exist
const SEPARATED_DIR = path.join(process.cwd(), "separated");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
fs.mkdirSync(SEPARATED_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Serve stems statically at /separated/*
router.use(
  "/separated",
  express.static(SEPARATED_DIR, {
    maxAge: "1h",
    etag: true,
    lastModified: true,
  })
);

// Multer: write uploads to disk
const upload = multer({
  dest: UPLOADS_DIR,
  // limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      return cb(new Error("Only audio files allowed"));
    }
    cb(null, true);
  },
});

// Run Demucs (CLI) and resolve URLs
// function runDemucs(
//   inputPath: string,
//   basename: string
// ): Promise<{
//   vocalsUrl: string;
//   accompanimentUrl: string;
// }> {
//   return new Promise((resolve, reject) => {
//     const model = "mdx_q";

//     // Point to venv bin dir (adjust if yours is elsewhere)
//     const VENV_BIN = path.join(process.env.HOME || "", "demucs_env", "bin");
//     const DEMUCS_BIN = process.env.DEMUCS_BIN || "demucs";

//     const args = [
//       "-d",
//       "cpu",
//       "-n",
//       model,
//       "--two-stems=vocals",
//       "-j",
//       "1",
//       "--overlap",
//       "0",
//       inputPath,
//     ];

//     const proc = spawn(DEMUCS_BIN, args, {
//       cwd: process.cwd(),
//       env: { ...process.env, PATH: `${VENV_BIN}:${process.env.PATH}` },
//     });

//     proc.on("error", (err) => reject(err)); // ← important to prevent crashes

//     proc.stdout.on("data", (d) => process.stdout.write(d));
//     proc.stderr.on("data", (d) => process.stderr.write(d));

//     proc.on("close", (code) => {
//       try {
//         fs.unlinkSync(inputPath);
//       } catch {}

//       if (code !== 0)
//         return reject(new Error(`Demucs exited with code ${code}`));

//       const stemBase = `/separated/${model}/${basename}`;
//       resolve({
//         vocalsUrl: `${stemBase}/vocals.wav`,
//         accompanimentUrl: `${stemBase}/no_vocals.wav`,
//       });
//     });
//   });
// }

// Run Demucs (CLI) and resolve URLs
function runDemucs(
  inputPath: string,
  basename: string
): Promise<{
  vocalsUrl: string;
  accompanimentUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const model = "mdx_q";

    // Point to venv bin dir (adjust if yours is elsewhere)
    const VENV_BIN = path.join(process.env.HOME || "", "demucs_env", "bin");
    const DEMUCS_BIN = process.env.DEMUCS_BIN || "demucs";

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

    const proc = spawn(DEMUCS_BIN, args, {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${VENV_BIN}:${process.env.PATH}` },
    });

    /* ───── GRANULAR PROGRESS LOGGER ───── */
    let lastPct = -1; // remember last printed %
    const logProgress = (chunk: Buffer) => {
      const txt = chunk.toString();
      // tqdm writes to stderr: " 35%|███▌      | …"
      const m = txt.match(/(\d{1,3})%/); // grab first percentage in line
      if (m) {
        const pct = Number(m[1]);
        if (!Number.isNaN(pct) && pct !== lastPct) {
          lastPct = pct;
          // Print every 2 % (adjust granularity here)
          if (pct % 2 === 0 || pct === 100) {
            console.log(`[demucs] progress: ${pct}%`);
          }
        }
      }
    };

    proc.stdout.on("data", (d) => process.stdout.write(d)); // optional
    proc.stderr.on("data", (d) => {
      process.stderr.write(d); // keep original bar
      logProgress(d); // and log clean %
    });

    proc.on("error", (err) => reject(err)); // prevents crashes

    proc.on("close", (code) => {
      try {
        fs.unlinkSync(inputPath);
      } catch {}

      if (code !== 0)
        return reject(new Error(`Demucs exited with code ${code}`));

      const stemBase = `/separated/${model}/${basename}`;
      resolve({
        vocalsUrl: `${stemBase}/vocals.wav`,
        accompanimentUrl: `${stemBase}/no_vocals.wav`,
      });
    });
  });
}

// Main handler
async function handleUpload(req: Request, res: Response) {
  try {
    console.log("request received");

    const file = (req as any).file as
      | { originalname: string; size: number; filename: string; path: string }
      | undefined;

    if (!file) {
      res.status(400).json({
        success: false,
        message: "No music file received. Field name must be 'file'.",
      });
      return;
    }

    console.log(`[upload_music] ${file.originalname} -> ${file.size} bytes`);

    const basename = file.filename; // Multer's random name
    const { vocalsUrl, accompanimentUrl } = await runDemucs(
      file.path,
      basename
    );

    res.status(200).json({
      success: true,
      size: file.size,
      originalName: file.originalname,
      vocalsUrl,
      accompanimentUrl,
    });
    return;
  } catch (err) {
    console.error("[upload_music] error:", err);
    res.status(500).json({ success: false });
    return;
  }
}

// POST /upload_music
// router.post("/upload_music", upload.single("file"), handleUpload);

router.post(
  "/upload_music",
  longTimeout, // <── added
  upload.single("file"), // existing
  handleUpload // existing
);

export default router;
