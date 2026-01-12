// lib/reddis.ts
// const connectionString = process.env.REDDIS_CONNECTIONSTRING;
// //@ts-ignore
// export const Redis = new RedisClient(connectionString);
// redis.ts
import Redis from "ioredis";
/**
 * Single helper to build connection options.
 * If you ever move Redis off-box, changing .env is enough.
 */
const redisOptions = process.env.REDDIS_CONNECTIONSTRING || {
    host: "127.0.0.1", // local VM
    port: 6379, // default Redis port
    password: process.env.REDIS_PASSWORD, // fallback if you split vars
};
//@ts-ignore
export const RedisClient = new Redis(redisOptions); // general use
