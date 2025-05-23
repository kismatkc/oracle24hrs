import express, { json } from "express";
import CORS from "cors";
import modifyStops from "./controllers/modify-stops.ts";
import streaks from "./controllers/streaks.ts";
import getTtcTimes from "./controllers/ttc-times.ts";
import weatherReport from "./controllers/weather-report.ts";
import wordBreakdown from "./controllers/word-breakdown.ts";
import setLastfrenchTopic from "./controllers/set-last-french-topic.ts";
import getLastfrenchTopic from "./controllers/get-last-french-topic.ts";
import downloadMp3 from "./controllers/download-mp3.ts";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(CORS());
app.use(json());
const PORT = process.env.PORT_COMMON; // Corrected environment variable

if (!PORT) {
  throw new Error("Please provide a valid port");
}
app.use("/", modifyStops);
app.use("/", streaks);
app.use("/", getTtcTimes);
app.use("/", weatherReport);
app.use("/", wordBreakdown);
app.use("/", setLastfrenchTopic);
app.use("/", getLastfrenchTopic);
app.use("/", downloadMp3);

app.use("/", async (req, res) => {
  res.send("Common routes");
});

app.listen(PORT, () => {
  console.log("Listening on port", PORT);
});
