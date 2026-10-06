import { createHmac, randomUUID } from "node:crypto";
import type { Redis } from "@upstash/redis";
import { getRedis } from "./redis";

/**
 * Admin chat log. Every member message is saved as one "exchange": the
 * question, the reply exactly as the member saw it (text and cards), any
 * transcript searches, dropped record IDs, token usage and cost. Exchanges
 * are grouped by an anonymous per-conversation ID, and visitors are a
 * one-way hash of the IP address; raw IPs are never stored. Everything
 * expires after a year.
 */

export const RETENTION_DAYS = 365;
const RETENTION_SECONDS = RETENTION_DAYS * 24 * 60 * 60;
const STATS_TTL_SECONDS = (RETENTION_DAYS + 35) * 24 * 60 * 60;
const P = "edge:log";
const TIME_ZONE = "America/New_York";

export type LoggedPart =
  | { type: "text"; text: string }
  | { type: "card"; id: string; kind: "Resource" | "Workshop"; title: string; url: string; desc: string };

export interface ExchangeLog {
  id: string;
  conversationId: string;
  at: number;
  visitor: string;
  status: "ok" | "error" | "rate_limited";
  question: string;
  parts: LoggedPart[];
  searches: { query: string; ids: string[] }[];
  droppedIds: string[];
  model?: string;
  tokens?: { input: number; cacheWrite: number; cacheRead: number; output: number };
  costUsd?: number;
  durationMs?: number;
}

export interface ConversationSummary {
  id: string;
  firstAt: number;
  lastAt: number;
  visitor: string;
  firstQuestion: string;
  messages: number;
  costUsd: number;
  noRecs: number;
  errors: number;
  dropped: number;
  rateLimited: number;
}

export interface DayStats {
  day: string;
  messages: number;
  conversations: number;
  costUsd: number;
  noRecs: number;
  errors: number;
  rateLimited: number;
}

export interface LogStore {
  save(x: ExchangeLog): Promise<void>;
  listConversations(offset: number, limit: number): Promise<{ total: number; items: ConversationSummary[] }>;
  getConversation(id: string): Promise<ExchangeLog[]>;
  recentExchanges(limit: number): Promise<ExchangeLog[]>;
  exchangesSince(since: number, max: number): Promise<ExchangeLog[]>;
  dailyStats(days: number, now?: Date): Promise<DayStats[]>;
  topItems(month: string): Promise<{ id: string; title: string; count: number }[]>;
}

export const CONVERSATION_ID = /^[A-Za-z0-9-]{8,64}$/;

export function newExchangeId(): string {
  return randomUUID();
}

export function hashVisitor(ip: string): string {
  const salt = process.env.LOG_SALT || process.env.ADMIN_PASSWORD || "edge-assistant";
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 12);
}

export function dayKey(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

export function monthKey(date: Date): string {
  return dayKey(date).slice(0, 7);
}

export function replyText(parts: LoggedPart[]): string {
  return parts
    .map((p) => (p.type === "text" ? p.text : `\n[${p.kind}: ${p.title}] ${p.desc.trim()}\n`))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cardsOf(x: ExchangeLog) {
  return x.parts.filter((p): p is Extract<LoggedPart, { type: "card" }> => p.type === "card");
}

export function isNoRec(x: ExchangeLog): boolean {
  return x.status === "ok" && cardsOf(x).length === 0;
}

// Kept on globalThis because Next.js bundles each route separately; the
// in-memory fallback must be shared by the chat API and the admin pages.
const shared = globalThis as typeof globalThis & { __edgeLogStore?: LogStore };

export function getLogStore(): LogStore {
  if (!shared.__edgeLogStore) {
    const redis = getRedis();
    shared.__edgeLogStore = redis ? new RedisLogStore(redis) : new MemoryLogStore();
  }
  return shared.__edgeLogStore;
}

// Logging must never break a member's chat.
export async function recordExchange(x: ExchangeLog): Promise<void> {
  try {
    await getLogStore().save(x);
  } catch (err) {
    console.error("Could not save chat log:", err instanceof Error ? err.message : err);
  }
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const MICRO = 1_000_000;

class RedisLogStore implements LogStore {
  constructor(private readonly redis: Redis) {}

  async save(x: ExchangeLog) {
    const day = dayKey(new Date(x.at));
    const conv = `${P}:c:${x.conversationId}`;
    const cards = cardsOf(x);
    const cost = Number.isFinite(x.costUsd) ? Math.round((x.costUsd ?? 0) * MICRO) : 0;
    const cutoff = x.at - RETENTION_SECONDS * 1000;

    // HSETNX tells us whether this is the conversation's first message.
    const isNew = (await this.redis.hsetnx(conv, "firstAt", x.at)) === 1;

    const p = this.redis.pipeline();
    p.set(`${P}:x:${x.id}`, x, { ex: RETENTION_SECONDS });
    if (isNew) {
      p.hset(conv, { visitor: x.visitor, firstQuestion: x.question.slice(0, 300) });
      p.hincrby(`${P}:day:${day}`, "conversations", 1);
    }
    p.hset(conv, { lastAt: x.at });
    p.hincrby(conv, "messages", 1);
    p.hincrby(conv, "costMicro", cost);
    if (isNoRec(x)) p.hincrby(conv, "noRecs", 1);
    if (x.status === "error") p.hincrby(conv, "errors", 1);
    if (x.status === "rate_limited") p.hincrby(conv, "rateLimited", 1);
    if (x.droppedIds.length) p.hincrby(conv, "dropped", x.droppedIds.length);
    p.expire(conv, RETENTION_SECONDS);
    p.zadd(`${conv}:x`, { score: x.at, member: x.id });
    p.expire(`${conv}:x`, RETENTION_SECONDS);
    p.zadd(`${P}:convs`, { score: x.at, member: x.conversationId });
    p.zremrangebyscore(`${P}:convs`, 0, cutoff);
    p.zadd(`${P}:xs`, { score: x.at, member: x.id });
    p.zremrangebyscore(`${P}:xs`, 0, cutoff);

    const dayStats = `${P}:day:${day}`;
    p.hincrby(dayStats, x.status === "rate_limited" ? "rateLimited" : "messages", 1);
    p.hincrby(dayStats, "costMicro", cost);
    if (isNoRec(x)) p.hincrby(dayStats, "noRecs", 1);
    if (x.status === "error") p.hincrby(dayStats, "errors", 1);
    p.expire(dayStats, STATS_TTL_SECONDS);

    if (cards.length) {
      const items = `${P}:items:${monthKey(new Date(x.at))}`;
      for (const c of cards) {
        p.hincrby(items, c.id, 1);
        p.hset(`${P}:titles`, { [c.id]: c.title });
      }
      p.expire(items, STATS_TTL_SECONDS);
    }
    await p.exec();
  }

  async listConversations(offset: number, limit: number) {
    const [total, ids] = await Promise.all([
      this.redis.zcard(`${P}:convs`),
      this.redis.zrange<string[]>(`${P}:convs`, offset, offset + limit - 1, { rev: true }),
    ]);
    if (!ids.length) return { total, items: [] };
    const p = this.redis.pipeline();
    for (const id of ids) p.hgetall(`${P}:c:${id}`);
    const rows = (await p.exec()) as (Record<string, unknown> | null)[];
    const items = ids.flatMap((id, i) => {
      const r = rows[i];
      if (!r) return [];
      return [
        {
          id,
          firstAt: num(r.firstAt),
          lastAt: num(r.lastAt),
          visitor: String(r.visitor ?? ""),
          firstQuestion: String(r.firstQuestion ?? ""),
          messages: num(r.messages),
          costUsd: num(r.costMicro) / MICRO,
          noRecs: num(r.noRecs),
          errors: num(r.errors),
          dropped: num(r.dropped),
          rateLimited: num(r.rateLimited),
        },
      ];
    });
    return { total, items };
  }

  async getConversation(id: string) {
    const ids = await this.redis.zrange<string[]>(`${P}:c:${id}:x`, 0, -1);
    return this.load(ids);
  }

  async recentExchanges(limit: number) {
    const ids = await this.redis.zrange<string[]>(`${P}:xs`, 0, limit - 1, { rev: true });
    return this.load(ids);
  }

  async exchangesSince(since: number, max: number) {
    const ids = await this.redis.zrange<string[]>(`${P}:xs`, since, "+inf", {
      byScore: true,
      offset: 0,
      count: max,
    });
    return this.load(ids);
  }

  async dailyStats(days: number, now = new Date()) {
    const keys = lastDays(days, now);
    const p = this.redis.pipeline();
    for (const d of keys) p.hgetall(`${P}:day:${d}`);
    const rows = (await p.exec()) as (Record<string, unknown> | null)[];
    return keys.map((day, i) => {
      const r = rows[i] ?? {};
      return {
        day,
        messages: num(r.messages),
        conversations: num(r.conversations),
        costUsd: num(r.costMicro) / MICRO,
        noRecs: num(r.noRecs),
        errors: num(r.errors),
        rateLimited: num(r.rateLimited),
      };
    });
  }

  async topItems(month: string) {
    const [counts, titles] = await Promise.all([
      this.redis.hgetall<Record<string, unknown>>(`${P}:items:${month}`),
      this.redis.hgetall<Record<string, unknown>>(`${P}:titles`),
    ]);
    return Object.entries(counts ?? {})
      .map(([id, count]) => ({ id, title: String(titles?.[id] ?? id), count: num(count) }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }

  private async load(ids: string[]): Promise<ExchangeLog[]> {
    const out: ExchangeLog[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const rows = await this.redis.mget<(ExchangeLog | null)[]>(...batch.map((id) => `${P}:x:${id}`));
      for (const row of rows) if (row) out.push(row);
    }
    return out;
  }
}

/** In-memory store for local development when Redis isn't configured. */
export class MemoryLogStore implements LogStore {
  private exchanges: ExchangeLog[] = [];

  async save(x: ExchangeLog) {
    const cutoff = x.at - RETENTION_SECONDS * 1000;
    this.exchanges = this.exchanges.filter((e) => e.at >= cutoff);
    this.exchanges.push(structuredClone(x));
  }

  async listConversations(offset: number, limit: number) {
    const groups = new Map<string, ExchangeLog[]>();
    for (const x of this.exchanges) groups.set(x.conversationId, [...(groups.get(x.conversationId) ?? []), x]);
    const all = [...groups.entries()]
      .map(([id, xs]) => ({
        id,
        firstAt: xs[0].at,
        lastAt: xs[xs.length - 1].at,
        visitor: xs[0].visitor,
        firstQuestion: xs[0].question.slice(0, 300),
        messages: xs.length,
        costUsd: xs.reduce((n, x) => n + (Number.isFinite(x.costUsd) ? (x.costUsd ?? 0) : 0), 0),
        noRecs: xs.filter(isNoRec).length,
        errors: xs.filter((x) => x.status === "error").length,
        dropped: xs.reduce((n, x) => n + x.droppedIds.length, 0),
        rateLimited: xs.filter((x) => x.status === "rate_limited").length,
      }))
      .sort((a, b) => b.lastAt - a.lastAt);
    return { total: all.length, items: all.slice(offset, offset + limit) };
  }

  async getConversation(id: string) {
    return this.exchanges.filter((x) => x.conversationId === id);
  }

  async recentExchanges(limit: number) {
    return this.exchanges.slice(-limit).reverse();
  }

  async exchangesSince(since: number, max: number) {
    return this.exchanges.filter((x) => x.at >= since).slice(0, max);
  }

  async dailyStats(days: number, now = new Date()) {
    return lastDays(days, now).map((day) => {
      const xs = this.exchanges.filter((x) => dayKey(new Date(x.at)) === day);
      const firstOf = new Map<string, ExchangeLog>();
      for (const x of this.exchanges) if (!firstOf.has(x.conversationId)) firstOf.set(x.conversationId, x);
      const started = [...firstOf.values()].filter((x) => dayKey(new Date(x.at)) === day).length;
      return {
        day,
        messages: xs.filter((x) => x.status !== "rate_limited").length,
        conversations: started,
        costUsd: xs.reduce((n, x) => n + (Number.isFinite(x.costUsd) ? (x.costUsd ?? 0) : 0), 0),
        noRecs: xs.filter(isNoRec).length,
        errors: xs.filter((x) => x.status === "error").length,
        rateLimited: xs.filter((x) => x.status === "rate_limited").length,
      };
    });
  }

  async topItems(month: string) {
    const counts = new Map<string, { id: string; title: string; count: number }>();
    for (const x of this.exchanges) {
      if (monthKey(new Date(x.at)) !== month) continue;
      for (const c of cardsOf(x)) {
        const row = counts.get(c.id) ?? { id: c.id, title: c.title, count: 0 };
        row.count++;
        counts.set(c.id, row);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }
}

// Most recent first.
function lastDays(days: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  return [...new Set(out)];
}
