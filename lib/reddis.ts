import RedisClient from "ioredis";
//@ts-ignore

export const Redis = new RedisClient(
  "rediss://default:AWyTAAIjcDEyMDBhOGU3NTkwMDI0N2JiODU4NDI3ZmEzNTJkNDY3NnAxMA@maximum-finch-27795.upstash.io:6379"
);
