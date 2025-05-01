import express, { json } from "express";
import CORS from "cors";

import dotenv from "dotenv";
import test from "./controllers/test.ts";

dotenv.config();

const app = express();
app.use(CORS());
app.use(json());
const PORT = 4000; // Corrected environment variable
test();
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
