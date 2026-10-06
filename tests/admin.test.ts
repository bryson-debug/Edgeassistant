import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionToken, passwordMatches, sessionValid } from "../lib/admin-auth";
import { hashVisitor, MemoryLogStore, replyText, type ExchangeLog } from "../lib/chat-log";
import { csvCell } from "../lib/csv";

process.env.ADMIN_PASSWORD = "correct horse battery staple";

test("password check and signed sessions", () => {
  assert.equal(passwordMatches("correct horse battery staple"), true);
  assert.equal(passwordMatches("wrong"), false);
  const token = createSessionToken();
  assert.equal(sessionValid(token), true);
  assert.equal(sessionValid(`${token}x`), false);
  assert.equal(sessionValid(`9999999999999.${token.split(".")[1]}`), false);
  assert.equal(sessionValid(createSessionToken(Date.now() - 13 * 60 * 60 * 1000)), false);
  assert.equal(sessionValid(undefined), false);
});

test("visitor hash hides the IP and is stable", () => {
  const h = hashVisitor("203.0.113.9");
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.equal(h, hashVisitor("203.0.113.9"));
  assert.notEqual(h, hashVisitor("203.0.113.10"));
  assert.ok(!h.includes("203"));
});

test("CSV cells are quoted and formula-safe", () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  assert.equal(csvCell("-5"), `"'-5"`);
  assert.equal(csvCell(12), '"12"');
});

function exchange(over: Partial<ExchangeLog>): ExchangeLog {
  return {
    id: crypto.randomUUID(),
    conversationId: "conv-aaaaaaaa",
    at: Date.now(),
    visitor: "abc123def456",
    status: "ok",
    question: "Do you have anything on transitions?",
    parts: [],
    searches: [],
    droppedIds: [],
    costUsd: 0.002,
    ...over,
  };
}

test("memory log store groups conversations and counts flags", async () => {
  const store = new MemoryLogStore();
  const now = Date.now();
  await store.save(
    exchange({
      at: now - 2000,
      parts: [
        { type: "text", text: "Here you go:\n" },
        { type: "card", id: "recUlYxE0T6iHsjJh", kind: "Resource", title: "Transitions Pack", url: "https://x.test/a", desc: "Songs." },
      ],
    }),
  );
  await store.save(exchange({ at: now - 1000, question: "That link is wrong.", parts: [{ type: "text", text: "Please email us." }] }));
  await store.save(exchange({ conversationId: "conv-bbbbbbbb", at: now, status: "rate_limited", costUsd: undefined }));

  const list = await store.listConversations(0, 10);
  assert.equal(list.total, 2);
  assert.equal(list.items[0].id, "conv-bbbbbbbb");
  const a = list.items[1];
  assert.equal(a.messages, 2);
  assert.equal(a.noRecs, 1);
  assert.equal(a.firstQuestion, "Do you have anything on transitions?");
  assert.ok(Math.abs(a.costUsd - 0.004) < 1e-9);

  const convo = await store.getConversation("conv-aaaaaaaa");
  assert.equal(convo.length, 2);
  assert.match(replyText(convo[0].parts), /\[Resource: Transitions Pack\] Songs\./);

  const [today] = await store.dailyStats(1);
  assert.equal(today.messages, 2);
  assert.equal(today.rateLimited, 1);
  assert.equal(today.conversations, 2);

  const top = await store.topItems(new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7));
  assert.deepEqual(top, [{ id: "recUlYxE0T6iHsjJh", title: "Transitions Pack", count: 1 }]);
});
