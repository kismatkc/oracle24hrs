import { Queue, QueueEvents } from "bullmq";
import { BullRedis as Redis } from "../../../lib/bullRedis.ts";

export const demucsQueue = new Queue("demucs", {
  connection: Redis,
  defaultJobOptions: {
    removeOnComplete: { age: 3600 * 72, count: 1000 }, // 72 hours
    removeOnFail: { age: 3600 * 24, count: 1000 }, // 24 hours
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
  },
});

export const demucsEvents = new QueueEvents("demucs", {
  connection: Redis,
});
