import RedisClient from "ioredis";
const connectionString = process.env.REDDIS_CONNECTIONSTRING;
//@ts-ignore
export const BullRedis = new RedisClient(connectionString, {
    // ⚠️ BullMQ requires this to be null for blocking calls (BLPOP, BRPOP, etc.)
    maxRetriesPerRequest: null,
});
