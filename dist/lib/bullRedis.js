// lib/bullRedis.ts
import RedisClient from "ioredis";
const connectionString = process.env.REDDIS_CONNECTIONSTRING;
//@ts-ignore
export const BullRedis = new RedisClient(connectionString, {
    // ⚠️ BullMQ requires this to be null for blocking calls (BLPOP, BRPOP, etc.)
    maxRetriesPerRequest: null,
});
// import Redis from "ioredis";
// /**
//  * BullMQ requires maxRetriesPerRequest = null so BLPOP et al.
//  * never time-out. Otherwise identical to the normal client.
//  */
// export const BullRedis = new Redis(redisOptions, {
//   maxRetriesPerRequest: null,
// });
