// import express, { json } from "express";
// import CORS from "cors";
// import getTtcAlerts from "../scraper/controllers/ttc-alerts.ts";
// import getSongLyrisc from "../scraper/controllers/scrape-lyrisc.ts";

// import dotenv from "dotenv";

// import downloadMp3 from "./controllers/download-mp3.ts";

// const app = express();

// app.use(CORS());
// app.use(json());
// const PORT = process.env.PORT_SCRAPER; // Corrected environment variable

// if (!PORT) {
//   throw new Error("Please provide a valid port");
// }

// app.use("/", getTtcAlerts);
// app.use("/", getSongLyrisc);
// app.use("/", downloadMp3);

// app.use("/", async (req, res) => {
//   console.log(req.url);

//   res.send("Scraper");
// });

// app.listen(PORT, () => {
//   console.log(`Scraper server is running on port ${PORT}`);
// });

import express, { json } from "express";
import CORS from "cors";

import getTtcAlerts from "../scraper/controllers/ttc-alerts.ts";
import getSongLyrisc from "../scraper/controllers/scrape-lyrisc.ts";
import downloadRouter from "../scraper/controllers/download-mp3.ts";

import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(CORS());
app.use(json());

const PORT = process.env.PORT_SCRAPER;
if (!PORT) throw new Error("Please provide a valid port");

/* your existing routers */
app.use("/", getTtcAlerts);
app.use("/", getSongLyrisc);
app.use("/", downloadRouter);

app.use("/", (_, res) => {
  res.send("Scraper");
});
app.listen(PORT, () => console.log("API up", PORT));
