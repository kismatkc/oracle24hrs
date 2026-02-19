// lib/appRedis.ts
// Shared Redis client for application state (download tracking, etc.)
// Separate from BullRedis which has maxRetriesPerRequest: null for BullMQ.

import RedisClient from "ioredis";

const connectionString = process.env.REDDIS_CONNECTIONSTRING!;

//@ts-ignore
export const appRedis = new RedisClient(connectionString, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
  keyPrefix: "app:",
});

appRedis.on("error", (err: any) => {
  console.error("[appRedis] connection error:", err.message);
});

appRedis.on("connect", () => {
  console.log("[appRedis] connected");
});
