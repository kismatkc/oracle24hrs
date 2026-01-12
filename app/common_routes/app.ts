// app/common_routes/app.ts


// app/common_routes/app.ts
import express from "express";
import CORS from "cors";
import { exec } from "child_process";

// 👉 Express 5 friendly route lister
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const listRoutes = require("express-list-routes");

import modifyStops from "./controllers/modify-stops.ts";
import streaks from "./controllers/streaks.ts";
import getTtcTimes from "./controllers/ttc-times.ts";
import weatherReport from "./controllers/weather-report.ts";
import setLastfrenchTopic from "./controllers/set-last-french-topic.ts";
import getLastfrenchTopic from "./controllers/get-last-french-topic.ts";
import uploadMuisc from "./controllers/upload-muisc.ts";
import stopwatchRoutes from "./stopwatch/routes.ts";

import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT_COMMON;
if (!PORT) throw new Error("Please provide a valid port (set PORT_COMMON).");

/* ---------- configuration ---------- */
const RESTART_SECRET = "Mohan9869868880"; // secret path segment
const BODY_LIMIT = process.env.BODY_LIMIT || "25mb";

app.use(CORS({ origin: "*" }));
app.options(/.*/, CORS({ origin: "*" }));
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

app.use((err: any, _req, res, next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "payload too large" });
  return next(err);
});

app.set("trust proxy", true); // req.protocol honors X-Forwarded-Proto

/* ---------- functional routes ---------- */
app.use("/", modifyStops);
app.use("/", streaks);
app.use("/", getTtcTimes);
app.use("/", weatherReport);
app.use("/", setLastfrenchTopic);
app.use("/", getLastfrenchTopic);
app.use("/", uploadMuisc);
app.use("/", stopwatchRoutes);

/* ---------- PM2 restart-all via GET ---------- */
app.get(`/restart/${RESTART_SECRET}`, (_req, res) => {
  res.json({ message: "Restarting all PM2 processes…" });
  exec("pm2 restart ecosystem.config.cjs", (error, stdout, stderr) => {
    if (error) console.error("PM2 restart failed:", error);
    if (stderr) console.error("PM2 stderr:", stderr);
    console.log("PM2 restart output:", stdout);
  });
});

/* ---------- list routes (minimal; Express v5) ---------- */
// Prints all registered endpoints to the console on boot.
listRoutes(app, { prefix: "", spacer: 7 });

/* ---------- catch-all ---------- */
app.use("/", (_req, res) => {
  res.send("Common routes");
});

/* ---------- start server ---------- */
app.listen(Number(PORT), () => {
  console.log(`Listening on port ${PORT}`);
});
