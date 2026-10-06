import { isAdmin } from "@/lib/admin-auth";
import { cardsOf, getLogStore, replyText, type ExchangeLog } from "@/lib/chat-log";
import { csvCell } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 50_000;

// CSV download of every message in the last N days.
export async function GET(request: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = await getLogStore().exchangesSince(since, MAX_ROWS);

  const header = [
    "time_utc",
    "time_eastern",
    "conversation_id",
    "visitor",
    "status",
    "question",
    "reply",
    "recommended_titles",
    "recommended_urls",
    "transcript_searches",
    "invalid_ids_dropped",
    "model",
    "input_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "output_tokens",
    "cost_usd",
    "duration_ms",
  ];
  const lines = [header.join(",")];
  for (const x of rows) lines.push(toRow(x).map(csvCell).join(","));

  const date = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="edge-assistant-log-${days}d-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function toRow(x: ExchangeLog): (string | number)[] {
  const cards = cardsOf(x);
  return [
    new Date(x.at).toISOString(),
    new Date(x.at).toLocaleString("en-US", { timeZone: "America/New_York" }),
    x.conversationId,
    x.visitor,
    x.status,
    x.question,
    replyText(x.parts),
    cards.map((c) => c.title).join(" | "),
    cards.map((c) => c.url).join(" | "),
    x.searches.map((s) => `${s.query} -> ${s.ids.join(" ") || "none"}`).join(" | "),
    x.droppedIds.join(" "),
    x.model ?? "",
    x.tokens?.input ?? "",
    x.tokens?.cacheRead ?? "",
    x.tokens?.cacheWrite ?? "",
    x.tokens?.output ?? "",
    Number.isFinite(x.costUsd) ? (x.costUsd ?? 0).toFixed(6) : "",
    x.durationMs ?? "",
  ];
}
