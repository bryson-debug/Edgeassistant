import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameOrigin, parseHistory } from "../lib/request";

test("origin must match the app's own host", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(isSameOrigin(h({ origin: "https://edge.example.app", host: "edge.example.app" })), true);
  assert.equal(isSameOrigin(h({ origin: "https://evil.example", host: "edge.example.app" })), false);
  assert.equal(isSameOrigin(h({ host: "edge.example.app" })), false);
  assert.equal(
    isSameOrigin(h({ origin: "https://edge.example.app", host: "internal", "x-forwarded-host": "edge.example.app" })),
    true,
  );
});

test("rejects messages over 1,000 characters", () => {
  const r = parseHistory({ messages: [{ role: "user", content: "a".repeat(1001) }] });
  assert.equal(r.ok, false);
  assert.equal(parseHistory({ messages: [{ role: "user", content: "a".repeat(1000) }] }).ok, true);
});

test("keeps the last 10 messages and starts with a member message", () => {
  const messages = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  const r = parseHistory({ messages });
  assert.ok(r.ok);
  if (r.ok) {
    assert.ok(r.messages.length <= 10);
    assert.equal(r.messages[0].role, "user");
    assert.equal(r.messages[r.messages.length - 1].content, "m14");
  }
});

test("rejects malformed conversations", () => {
  assert.equal(parseHistory({}).ok, false);
  assert.equal(parseHistory({ messages: [{ role: "system", content: "x" }] }).ok, false);
  assert.equal(parseHistory({ messages: [{ role: "assistant", content: "x" }] }).ok, false);
  assert.equal(parseHistory({ messages: [{ role: "user", content: "a" }, { role: "user", content: "b" }] }).ok, false);
});
