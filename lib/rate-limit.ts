import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const HOURLY_LIMIT = 30;
export const DAILY_LIMIT = 100;

export const RATE_LIMIT_MESSAGE =
  "You've sent a lot of messages! To keep the assistant available for every member, there's a limit of 30 messages an hour and 100 a day. Please check back a little later.";

interface Limiter {
  limit(key: string): Promise<{ success: boolean }>;
}

let limiters: { hourly: Limiter; daily: Limiter } | null = null;

function getLimiters() {
  if (limiters) return limiters;
  // The Vercel Marketplace Upstash integration sets KV_REST_API_*; a direct
  // Upstash setup uses UPSTASH_REDIS_REST_*.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const redis = new Redis({ url, token });
    limiters = {
      hourly: new Ratelimit({ redis, prefix: "edge:rl:h", limiter: Ratelimit.slidingWindow(HOURLY_LIMIT, "1 h") }),
      daily: new Ratelimit({ redis, prefix: "edge:rl:d", limiter: Ratelimit.slidingWindow(DAILY_LIMIT, "1 d") }),
    };
  } else {
    // Without Redis each server instance counts on its own, which is fine for
    // local development but much weaker in production.
    console.error("Rate limiting is using in-memory counters: connect Upstash Redis for production.");
    limiters = {
      hourly: new MemoryLimiter(HOURLY_LIMIT, 60 * 60 * 1000),
      daily: new MemoryLimiter(DAILY_LIMIT, 24 * 60 * 60 * 1000),
    };
  }
  return limiters;
}

export async function checkRateLimit(visitor: string): Promise<boolean> {
  const { hourly, daily } = getLimiters();
  const [h, d] = await Promise.all([hourly.limit(visitor), daily.limit(visitor)]);
  return h.success && d.success;
}

// The first X-Forwarded-For entry is the client address on Vercel.
export function visitorKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

class MemoryLimiter implements Limiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  async limit(key: string) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    const success = recent.length < this.max;
    if (success) recent.push(now);
    this.hits.set(key, recent);
    return { success };
  }
}
