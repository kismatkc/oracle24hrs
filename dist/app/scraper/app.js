import express, { json } from "express";
import CORS from "cors";
import getTtcAlerts from "../scraper/controllers/ttc-alerts.js";
import getSongLyrisc from "../scraper/controllers/scrape-lyrisc.js";
import getYoutubeCookie from "../scraper/controllers/get-youtube-cookies.js";
import dotenv from "dotenv";
dotenv.config();
const app = express();
app.use(CORS());
app.use(json());
const PORT = process.env.PORT_SCRAPER; // Corrected environment variable
if (!PORT) {
    throw new Error("Please provide a valid port");
}
app.use("/", getTtcAlerts);
app.use("/", getSongLyrisc);
app.use("/", getYoutubeCookie);
app.use("/", async (req, res) => {
    res.send("Scraper");
});
app.listen(PORT, () => {
    console.log("Listening on port", PORT);
});
