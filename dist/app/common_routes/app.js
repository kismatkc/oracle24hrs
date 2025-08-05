import express, { json } from "express";
import CORS from "cors";
import { exec } from "child_process";
import modifyStops from "./controllers/modify-stops.js";
import streaks from "./controllers/streaks.js";
import getTtcTimes from "./controllers/ttc-times.js";
import weatherReport from "./controllers/weather-report.js";
import setLastfrenchTopic from "./controllers/set-last-french-topic.js";
import getLastfrenchTopic from "./controllers/get-last-french-topic.js";
import uploadMuisc from "./controllers/upload-muisc.js";
import dotenv from "dotenv";
dotenv.config();
const app = express();
const PORT = process.env.PORT_COMMON;
if (!PORT) {
    throw new Error("Please provide a valid port (set PORT_COMMON).");
}
/* ---------- configuration ---------- */
const RESTART_SECRET = "Mohan9869868880"; // secret path segment
/* ---------- middleware ---------- */
// app.use(CORS());
app.use(CORS({
    origin: "*", // allow any origin
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(json());
/* ---------- functional routes ---------- */
app.use("/", modifyStops);
app.use("/", streaks);
app.use("/", getTtcTimes);
app.use("/", weatherReport);
app.use("/", setLastfrenchTopic);
app.use("/", getLastfrenchTopic);
app.use("/", uploadMuisc);
/* ---------- PM2 restart‑all via GET ---------- */
app.get(`/restart/${RESTART_SECRET}`, (req, res) => {
    res.json({ message: "Restarting all PM2 processes…" });
    exec("pm2 restart ecosystem.config.cjs", (error, stdout, stderr) => {
        if (error) {
            console.error("PM2 restart failed:", error);
            return;
        }
        if (stderr) {
            console.error("PM2 stderr:", stderr);
        }
        console.log("PM2 restart output:", stdout);
        console.log("PM2 restarted ALL processes successfully");
    });
});
/* ---------- catch‑all ---------- */
app.use("/", (_, res) => {
    res.send("Common routes");
});
/* ---------- start server ---------- */
app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});
