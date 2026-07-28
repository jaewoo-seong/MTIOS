import Redis from "ioredis";

const globalRedis = globalThis as typeof globalThis & { __businessOsRedis?: Redis };

export const redis = process.env.REDIS_URL
  ? globalRedis.__businessOsRedis ?? new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true
    })
  : null;

if (redis) globalRedis.__businessOsRedis = redis;

export async function pingRedis() {
  if (!redis) return "not_configured";
  if (redis.status === "wait") await redis.connect();
  await redis.ping();
  return "ok";
}
