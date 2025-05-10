import express, { Request, Response } from "express";
import { Redis } from "../../../lib/reddis.ts";

const router = express.Router();

async function getLastFrenchTopic(req: Request, res: Response) {
  try {
    const response = await Redis.get("set-last-french-topic");

    res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
    });
  }
}

router.get("/get-last-french-topic", getLastFrenchTopic);
export default router;
