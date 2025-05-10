import express, { Request, Response } from "express";
import { Redis } from "../../../lib/reddis.ts";

const router = express.Router();

async function setLastFrenchTopic(req: Request, res: Response) {
  try {
    const topic = req.body.topic;

    const response = await Redis.set("set-last-french-topic", topic);
    res.status(200).json({
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
    });
  }
}

router.post("/set-last-french-topic", setLastFrenchTopic);
export default router;
