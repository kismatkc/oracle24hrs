// app/music/app.ts
import express from "express";
import CORS from "cors";
import { exec } from "child_process";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const listRoutes = require("express-list-routes");

// Import all controllers
import uploadMusic from "./controllers/upload-music.ts";
import downloadMp3 from "./controllers/download-mp3.ts";
import scrapeLyrics from "./controllers/scrape-lyrics.ts";
import ttcAlerts from "./controllers/ttc-alerts.ts";
import youtube from "./controllers/youtube.ts";
import cacheManagement from "./controllers/cache-management.ts";
import shazam from "./controllers/shazam.ts";
import dailyWords from "./controllers/daily-words.ts";
import morningKnowledge from "./controllers/morning-knowledge.ts";
import reelTranscript from "./controllers/reel.ts";
import reelAnalyze from "./controllers/reel-analyze.ts";
import redditSummarize from "./controllers/reddit-summarize.ts";

// Import and start the demucs worker
import { demucsWorker } from "./workers/demucs.worker.ts";

import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT_MUSIC || 3000;

/* ---------- configuration ---------- */
const RESTART_SECRET = "Mohan9869868880";
const BODY_LIMIT = process.env.BODY_LIMIT || "25mb";

app.use(CORS({ origin: "*" }));
app.options(/.*/, CORS({ origin: "*" }));
// gzip handled by nginx — no need for Express compression
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

app.use((err: any, _req: any, res: any, next: any) => {
  if (err?.type === "entity.too.large")
    return res.status(413).json({ error: "payload too large" });
  return next(err);
});

app.set("trust proxy", true);

/* ---------- All routes under /music prefix ---------- */
app.use("/music", uploadMusic);
app.use("/music", downloadMp3);
app.use("/music", scrapeLyrics);
app.use("/music", ttcAlerts);
app.use("/music/youtube", youtube);
app.use("/music", cacheManagement);
app.use("/music", shazam);

/* ---------- Ontime routes (lifestyle app) ---------- */
app.use("/ontime", dailyWords);
app.use("/ontime", morningKnowledge);

/* ---------- API routes ---------- */
app.use("/api", reelTranscript);
app.use("/api", reelAnalyze);
app.use("/api", redditSummarize);

/* ---------- PM2 restart-all via GET ---------- */
app.get(`/restart/${RESTART_SECRET}`, (_req, res) => {
  res.json({ message: "Restarting all PM2 processes…" });
  exec("pm2 restart ecosystem.config.cjs", (error, stdout, stderr) => {
    if (error) console.error("PM2 restart failed:", error);
    if (stderr) console.error("PM2 stderr:", stderr);
    console.log("PM2 restart output:", stdout);
  });
});

/* ---------- list routes ---------- */
listRoutes(app, { prefix: "", spacer: 7 });

/* ---------- catch-all ---------- */
app.use("/", (_req, res) => {
  res.send("Music API Server");
});

/* ---------- start server ---------- */
app.listen(Number(PORT), () => {
  console.log(`Music API listening on port ${PORT}`);
  console.log(
    `Demucs worker status: ${demucsWorker ? "running" : "not started"}`,
  );
});
