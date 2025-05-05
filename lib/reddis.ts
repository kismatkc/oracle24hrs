import RedisClient from "ioredis";
const connectionString = process.env.REDDIS_CONNECTIONSTRING;

//@ts-ignore
export const Redis = new RedisClient(connectionString);
