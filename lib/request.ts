import type Anthropic from "@anthropic-ai/sdk";
import { HISTORY_MESSAGES, MAX_USER_MESSAGE_CHARS } from "./config";

const MAX_ASSISTANT_CHARS = 6000;
const MAX_INCOMING_MESSAGES = 60;

// The chat API only accepts requests made by the assistant's own page.
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
}

export type ParsedHistory = { ok: true; messages: Anthropic.MessageParam[] } | { ok: false; error: string };

/**
 * Validates the browser's conversation and trims it to the last
 * HISTORY_MESSAGES messages, starting with a member message.
 */
export function parseHistory(body: unknown): ParsedHistory {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_INCOMING_MESSAGES) {
    return { ok: false, error: "Invalid conversation." };
  }

  const messages: Anthropic.MessageParam[] = [];
  for (const entry of raw) {
    const role = (entry as { role?: unknown })?.role;
    const content = (entry as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return { ok: false, error: "Invalid conversation." };
    }
    const text = content.trim();
    if (!text) return { ok: false, error: "Invalid conversation." };
    if (role === "user" && text.length > MAX_USER_MESSAGE_CHARS) {
      return { ok: false, error: `Messages can be up to ${MAX_USER_MESSAGE_CHARS} characters.` };
    }
    if (role === "assistant" && text.length > MAX_ASSISTANT_CHARS) {
      return { ok: false, error: "Invalid conversation." };
    }
    const previous = messages[messages.length - 1];
    if (previous?.role === role) return { ok: false, error: "Invalid conversation." };
    messages.push({ role, content: text });
  }
  if (messages[messages.length - 1].role !== "user") return { ok: false, error: "Invalid conversation." };

  let recent = messages.slice(-HISTORY_MESSAGES);
  if (recent[0].role !== "user") recent = recent.slice(1);
  return { ok: true, messages: recent };
}
