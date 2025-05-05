import express, { json } from "express";
import CORS from "cors";

import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(CORS());
app.use(json());
const PORT = process.env.PORT_SHIFTS; // Corrected environment variable

if (!PORT) {
  throw new Error("Please provide a valid port");
}

// app.use("/", getTtcAlerts);
console.log("Shifts routes");

app.use("/", async (req, res) => {
  res.send("Shifts");
});

app.listen(PORT, () => {
  console.log("Listening on port", PORT);
});
