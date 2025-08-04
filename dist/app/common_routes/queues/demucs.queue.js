import { Queue, QueueEvents } from "bullmq"; // [ADD] BullMQ job queue & event stream
import { BullRedis as Redis } from "../../../lib/bullRedis.js";
export const demucsQueue = new Queue("demucs", {
    // [ADD] Define a queue named "demucs"
    connection: Redis, // [ADD] Use your Upstash Redis connection
    defaultJobOptions: {
        // [ADD] Reasonable defaults for size & reliability
        removeOnComplete: { age: 3600, count: 1000 }, // [ADD] Auto-purge completed jobs (≤1h or ≤1000)
        removeOnFail: { age: 86400, count: 1000 }, // [ADD] Auto-purge failed jobs (≤24h or ≤1000)
        attempts: 2, // [ADD] Retry once on transient failure
        backoff: { type: "exponential", delay: 30000 }, // [ADD] 30s exponential backoff between attempts
    },
});
export const demucsEvents = new QueueEvents("demucs", {
    // [ADD] Event emitter (useful if you add websockets later)
    connection: Redis, // [ADD] Same Upstash connection
});
