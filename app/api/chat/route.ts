import { FRIENDLY_ERROR, runChat } from "@/lib/chat";
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

  try {
    if (!(await checkRateLimit(visitorKey(request.headers)))) {
      return Response.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }
  } catch (err) {
    console.error("Rate limit check failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: FRIENDLY_ERROR }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runChat(history.messages)) {
          // Usage and tool details stay on the server.
          if (event.type === "usage" || event.type === "tool") continue;
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (err) {
        console.error("Chat stream failed:", err instanceof Error ? err.message : err);
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", text: FRIENDLY_ERROR })}\n`));
      } finally {
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
