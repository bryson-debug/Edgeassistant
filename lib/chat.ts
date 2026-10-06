import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { getCatalog, type Catalog } from "./catalog";
import { getModel, MAX_REPLY_TOKENS, MAX_TOOL_ROUNDS } from "./config";
import { ReplyFilter, type ReplyPart } from "./reply-filter";
import { searchTranscripts } from "./transcripts";

export type ChatEvent =
  | ReplyPart
  | { type: "error"; text: string }
  // Internal events: used by the test script, never sent to the browser.
  | { type: "usage"; model: string; usage: Anthropic.Usage }
  | { type: "tool"; query: string; ids: string[] };

export const FRIENDLY_ERROR =
  "Sorry, I'm having trouble right now. Please try again in a moment, or email hello@thatmusicteacher.com if it keeps happening.";

let systemPrompt: string | null = null;

// The system prompt lives in prompts/system-prompt.txt so it can be edited
// without touching code.
export function getSystemPrompt(): string {
  if (systemPrompt === null) {
    systemPrompt = fs.readFileSync(path.join(process.cwd(), "prompts", "system-prompt.txt"), "utf8").trim();
  }
  return systemPrompt;
}

const SEARCH_TOOL: Anthropic.Tool = {
  name: "search_transcripts",
  description:
    "Keyword search across workshop transcripts. Returns up to 5 matching workshop record IDs, each with a two-sentence snippet showing where the topic comes up. Use it only when the catalog has no clear match.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A few keywords for the topic, for example \"call and response transitions\".",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  eager_input_streaming: true,
};

function todayLine(now: Date): string {
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
  return `Today's date is ${date}.`;
}

export interface RunChatOptions {
  client?: Anthropic;
  now?: Date;
}

/**
 * Runs one assistant reply for the given conversation (already trimmed and
 * validated, ending with a user message) and yields reply parts as they
 * stream in.
 */
export async function* runChat(
  history: Anthropic.MessageParam[],
  options: RunChatOptions = {},
): AsyncGenerator<ChatEvent> {
  const client = options.client ?? new Anthropic();
  let catalog: Catalog;
  try {
    catalog = await getCatalog();
  } catch (err) {
    console.error("Could not load catalog:", err instanceof Error ? err.message : err);
    yield { type: "error", text: FRIENDLY_ERROR };
    return;
  }

  const model = getModel();
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: getSystemPrompt() },
    // Cache breakpoint: tools + system prompt + catalog form the cached prefix.
    { type: "text", text: catalog.promptText, cache_control: { type: "ephemeral" } },
    // Changes daily, so it sits after the breakpoint.
    { type: "text", text: todayLine(options.now ?? new Date()) },
  ];

  const filter = new ReplyFilter(
    (id) => catalog.items.get(id),
    (id) => console.error(`Dropped unknown record ID from reply: ${JSON.stringify(id)}`),
  );
  const messages: Anthropic.MessageParam[] = [...history];
  let emittedText = false;

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const lastRound = round === MAX_TOOL_ROUNDS;
      const stream = client.messages.stream({
        model,
        max_tokens: MAX_REPLY_TOKENS,
        system,
        tools: [SEARCH_TOOL],
        // On the last allowed round Claude must answer with what it has.
        tool_choice: lastRound ? { type: "none" } : { type: "auto" },
        messages,
      });

      if (emittedText) yield* emit(filter.push("\n\n"));
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const parts = filter.push(event.delta.text);
          if (parts.length) emittedText = true;
          yield* emit(parts);
        }
      }
      const message = await stream.finalMessage();
      yield { type: "usage", model: message.model, usage: message.usage };

      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const query = (use.input as { query?: unknown } | null)?.query;
        if (use.name !== SEARCH_TOOL.name || typeof query !== "string" || !query.trim() || query.length > 300) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Invalid input: pass a short keyword query string." });
          continue;
        }
        const matches = searchTranscripts(catalog.transcripts, query, 5).filter((m) => catalog.items.has(m.id));
        yield { type: "tool", query, ids: matches.map((m) => m.id) };
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: matches.length
            ? matches.map((m) => `${m.id}\nSnippet: ${m.snippet}`).join("\n\n")
            : "No transcripts matched.",
        });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    console.error("Claude request failed:", describeError(err));
    yield* emit(filter.flush());
    yield { type: "error", text: FRIENDLY_ERROR };
    return;
  }

  yield* emit(filter.flush());
}

function* emit(parts: ReplyPart[]): Generator<ChatEvent> {
  for (const part of parts) yield part;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `${err.status ?? "?"} ${err.name}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
