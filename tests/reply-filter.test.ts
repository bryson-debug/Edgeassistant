import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogItem } from "../lib/catalog";
import { ReplyFilter, sanitizeText, type ReplyPart } from "../lib/reply-filter";

const ITEMS: Record<string, CatalogItem> = {
  recUlYxE0T6iHsjJh: {
    id: "recUlYxE0T6iHsjJh",
    kind: "Resource",
    title: "Elementary Music Transitions Resource Pack",
    author: "Bryson Tarbet",
    description: "",
    url: "https://drive.google.com/file/d/15DDKPO2fnjDXeDYqbNscWjU1daTCnsa4/view",
  },
  recYYG1HJjYcPJz7G: {
    id: "recYYG1HJjYcPJz7G",
    kind: "Workshop",
    title: "Improving Lesson Transitions",
    author: "Bryson Tarbet, M.M.Ed.",
    description: "",
    url: "https://thatmusicteacher.thrivecart.com/l/elementary-music-edge/improving-lesson-transitions-with-bryson-tarbet-mmed/",
  },
};

function run(chunks: string[]) {
  const unknown: string[] = [];
  const filter = new ReplyFilter((id) => ITEMS[id], (id) => unknown.push(id));
  const parts: ReplyPart[] = [];
  for (const c of chunks) parts.push(...filter.push(c));
  parts.push(...filter.flush());
  // Merge across pushes the same way the browser does.
  const merged: ReplyPart[] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (p.type !== "card" && last && last.type !== "card" && last.type === p.type) last.text += p.text;
    else merged.push({ ...p });
  }
  return { parts: merged, unknown };
}

// Splits text into small chunks at every possible position to mimic streaming.
function chunked(text: string, size: number) {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const REPLY =
  "Great question! Here are two picks:\n\n{{recYYG1HJjYcPJz7G}}\nA workshop on **smooth** transitions.\n\n{{recUlYxE0T6iHsjJh}}\nReady-to-use transition songs.\n\nEnjoy!";

test("tokens become cards with the exact Airtable title and URL, at any chunk size", () => {
  for (const size of [1, 2, 3, 5, 8, 13, 400]) {
    const { parts, unknown } = run(chunked(REPLY, size));
    assert.deepEqual(unknown, []);
    const cards = parts.filter((p) => p.type === "card");
    assert.equal(cards.length, 2, `size ${size}`);
    assert.deepEqual(cards[0], {
      type: "card",
      id: "recYYG1HJjYcPJz7G",
      kind: "Workshop",
      title: "Improving Lesson Transitions",
      url: ITEMS.recYYG1HJjYcPJz7G.url,
    });
    const descs = parts.filter((p) => p.type === "desc").map((p) => (p as { text: string }).text.trim());
    assert.deepEqual(descs, ["A workshop on **smooth** transitions.", "Ready-to-use transition songs."]);
    const text = parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
    assert.match(text, /Great question!/);
    assert.match(text, /Enjoy!/);
  }
});

test("unknown record IDs are dropped and reported", () => {
  const { parts, unknown } = run(chunked("Try this:\n{{recAAAAAAAAAAAAAA}}\nMade up.\n", 3));
  assert.deepEqual(unknown, ["recAAAAAAAAAAAAAA"]);
  assert.equal(parts.filter((p) => p.type === "card").length, 0);
});

test("tokens with inner spaces still resolve", () => {
  const { parts } = run(["{{ recUlYxE0T6iHsjJh }}\nSongs."]);
  assert.equal(parts[0].type, "card");
});

test("URLs Claude writes are stripped, except the support mailto", () => {
  const cases: [string, string][] = [
    ["See https://drive.google.com/file/d/abc/view for more.", "See  for more."],
    ["Visit www.example.com.", "Visit ."],
    ["Go to thatmusicteacher.thrivecart.com/l/x now", "Go to  now"],
    ["Or google.com", "Or "],
    ["Email mailto:hello@thatmusicteacher.com today", "Email mailto:hello@thatmusicteacher.com today"],
    ["Email mailto:someone@else.com today", "Email  today"],
    ["Email hello@thatmusicteacher.com.", "Email hello@thatmusicteacher.com."],
    ["[Open it](https://evil.example/x) now", "Open it now"],
    ["(http://x.y/z)", "()"],
    ["Use ftp://files.example.com/a", "Use "],
    ["K-5 rhythm, e.g. ta and ti-ti.", "K-5 rhythm, e.g. ta and ti-ti."],
  ];
  for (const [input, expected] of cases) assert.equal(sanitizeText(input), expected, input);
});

test("a URL split across stream chunks is still stripped", () => {
  const { parts } = run(chunked("Here: https://drive.google.com/file/d/15DDKPO2fnjDXeDYqbNscWjU1daTCnsa4/view ok", 4));
  const text = parts.map((p) => (p.type === "card" ? "" : p.text)).join("");
  assert.doesNotMatch(text, /drive|https/);
});

test("malformed tokens never leak braces", () => {
  const { parts } = run(["{{recUlYxE0T6iHsjJh}\nOops {{ and }} done"]);
  const text = parts.map((p) => (p.type === "card" ? "" : p.text)).join("");
  assert.doesNotMatch(text, /[{}]/);
});
