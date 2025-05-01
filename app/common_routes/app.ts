import express, { json } from "express";
import CORS from "cors";
import modifyStops from "./controllers/modify-stops.ts";
import streaks from "./controllers/streaks.ts";
import getTtcTimes from "./controllers/ttc-times.ts";
import weatherReport from "./controllers/weather-report.ts";
import wordBreakdown from "./controllers/word-breakdown.ts";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(CORS());
app.use(json());
const PORT = process.env.PORT_common; // Corrected environment variable

if (!PORT) {
  throw new Error("Please provide a valid port");
}
app.use("/", modifyStops);
app.use("/", streaks);
app.use("/", getTtcTimes);
app.use("/", weatherReport);
app.use("/", wordBreakdown);

app.use("/", async (req, res) => {
  res.send("Common routes");
});

app.listen(PORT, () => {
  console.log("Listening on port", PORT);
});
