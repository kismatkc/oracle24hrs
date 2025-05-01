import express, { Request, Response } from "express";
import { Redis } from "../../../lib/reddis.ts";

const router = express.Router();

async function deleteSuccessLists(activity) {
  // Returns the number of keys removed (0 or 1)

  return await Redis.del(`activity:${activity}:successful`);
}
async function deleteFailureLists(activity) {
  // Returns the number of keys removed (0 or 1)

  return await Redis.del(`activity:${activity}:failure`);
}

// Add a successful date to an activity
async function addSuccessfulDate(activity, date) {
  await Redis.lpush(`activity:${activity}:successful`, date);
}

// Add a failure date to an activity
async function addFailureDate(activity, date) {
  await Redis.lpush(`activity:${activity}:failure`, date);
}

// Get all successful dates for an activity
async function getSuccessfulDates(activity) {
  return await Redis.lrange(`activity:${activity}:successful`, 0, -1);
}

// Get all failure dates for an activity
async function getFailureDates(activity) {
  return await Redis.lrange(`activity:${activity}:failure`, 0, -1);
}

async function streaks(req: Request, res: Response) {
  try {
    const { activity, date, event } = req.body as {
      activity: string;
      date: string;
      event: string;
    };

    if (event === "addSuccessfulDate") {
      await addSuccessfulDate(activity, date);
    }
    if (event === "addFailureDate") {
      await addFailureDate(activity, date);
    }
    if (event === "getSuccessfulDates") {
      const success = await getSuccessfulDates(activity);

      res.status(200).json({
        success: true,
        data: success,
      });
      return;
    }
    if (event === "getFailureDates") {
      const failures = await getFailureDates(activity);

      res.status(200).json({
        success: true,
        data: failures,
      });
      return;
    }
    if (event === "deleteSuccessList") {
      await deleteSuccessLists(activity);
    }
    if (event === "deleteFailureList") {
      await deleteFailureLists(activity);
    }

    res.status(201).json({
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
    });
  }
}

router.post("/streaks", streaks);
export default router;
