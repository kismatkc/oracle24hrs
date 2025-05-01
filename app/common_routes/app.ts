import express, { json } from "express";
import CORS from "cors";

import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(CORS());
app.use(json());
const PORT = process.env.PORT; // Corrected environment variable

if (!PORT) {
  throw new Error("Please provide a valid port");
}

// app.use("/", getTtcAlerts);

app.use("/common", async (req, res) => {
  res.send("Common routes");
});

app.listen(PORT, () => {
  console.log("Listening on port", PORT);
});
