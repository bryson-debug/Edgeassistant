import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

// The Vercel Marketplace Upstash integration sets KV_REST_API_*; a direct
// Upstash setup uses UPSTASH_REDIS_REST_*. Returns null when neither is set.
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}
