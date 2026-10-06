import { randomUUID } from "node:crypto";
import { FRIENDLY_ERROR, runChat, type ChatEvent } from "@/lib/chat";
import { CONVERSATION_ID, hashVisitor, newExchangeId, recordExchange, type ExchangeLog } from "@/lib/chat-log";
import { costOf } from "@/lib/pricing";
import { checkRateLimit, RATE_LIMIT_MESSAGE, visitorKey } from "@/lib/rate-limit";
import { isSameOrigin, parseHistory } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isSameOrigin(request.headers)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const history = parseHistory(body);
  if (!history.ok) return Response.json({ error: history.error }, { status: 400 });

  const ip = visitorKey(request.headers);
  const rawConversationId = (body as { conversationId?: unknown }).conversationId;
  const log: ExchangeLog = {
    id: newExchangeId(),
    conversationId:
      typeof rawConversationId === "string" && CONVERSATION_ID.test(rawConversationId)
        ? rawConversationId
        : `unknown-${randomUUID()}`,
    at: Date.now(),
    visitor: hashVisitor(ip),
    status: "ok",
    question: String(history.messages[history.messages.length - 1].content),
    parts: [],
    searches: [],
    droppedIds: [],
  };

  try {
    if (!(await checkRateLimit(ip))) {
      await recordExchange({ ...log, status: "rate_limited" });
      return Response.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }
  } catch (err) {
    console.error("Rate limit check failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: FRIENDLY_ERROR }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runChat(history.messages)) {
          addToLog(log, event);
          // Usage, searches and dropped IDs stay on the server.
          if (event.type === "usage" || event.type === "tool" || event.type === "dropped") continue;
          send(event);
        }
      } catch (err) {
        console.error("Chat stream failed:", err instanceof Error ? err.message : err);
        const event: ChatEvent = { type: "error", text: FRIENDLY_ERROR };
        addToLog(log, event);
        send(event);
      } finally {
        log.durationMs = Date.now() - log.at;
        // Saved before closing: serverless functions can be frozen once the
        // response ends.
        await recordExchange(log);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

// Rebuilds the reply the same way the browser does, plus server-only details.
function addToLog(log: ExchangeLog, event: ChatEvent) {
  const last = log.parts[log.parts.length - 1];
  switch (event.type) {
    case "text":
      if (last?.type === "text") last.text += event.text;
      else log.parts.push({ type: "text", text: event.text });
      break;
    case "card":
      log.parts.push({ ...event, desc: "" });
      break;
    case "desc":
      if (last?.type === "card") last.desc += event.text;
      break;
    case "error":
      log.status = "error";
      log.parts.push({ type: "text", text: `\n\n${event.text}` });
      break;
    case "tool":
      log.searches.push({ query: event.query, ids: event.ids });
      break;
    case "dropped":
      log.droppedIds.push(...event.ids);
      break;
    case "usage": {
      const t = (log.tokens ??= { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
      t.input += event.usage.input_tokens ?? 0;
      t.cacheWrite += event.usage.cache_creation_input_tokens ?? 0;
      t.cacheRead += event.usage.cache_read_input_tokens ?? 0;
      t.output += event.usage.output_tokens ?? 0;
      log.model = event.model;
      log.costUsd = (log.costUsd ?? 0) + costOf(event.model, event.usage);
      break;
    }
  }
}
