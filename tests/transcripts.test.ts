import assert from "node:assert/strict";
import { test } from "node:test";
import { bestSnippet, keywords, searchTranscripts } from "../lib/transcripts";

const transcripts = new Map([
  ["recA", "Welcome everyone. Today we talk about transitions. A good transition song saves minutes. We also cover lining up. Thanks for coming."],
  ["recB", "This session is about ukulele chords. Strumming patterns come next. Transitions between chords are hard."],
  ["recC", "Folk dance is joyful. Circle dances work for every grade."],
]);

test("keywords drop stopwords and punctuation", () => {
  assert.deepEqual(keywords("What do you have for lesson transitions?"), ["lesson", "transitions"]);
});

test("ranks workshops by matching terms and returns two-sentence snippets", () => {
  const results = searchTranscripts(transcripts, "transition song");
  assert.equal(results[0].id, "recA");
  assert.equal(results.length, 2);
  assert.equal(results[0].snippet.split(/(?<=[.!?])\s+/).length, 2);
  assert.match(results[0].snippet, /transition song/);
});

test("no matches and empty queries return nothing", () => {
  assert.deepEqual(searchTranscripts(transcripts, "bagpipes"), []);
  assert.deepEqual(searchTranscripts(transcripts, "the and of"), []);
});

test("returns at most the limit", () => {
  const many = new Map(Array.from({ length: 9 }, (_, i) => [`rec${i}`, `Rhythm sentence ${i}. Another one.`]));
  assert.equal(searchTranscripts(many, "rhythm").length, 5);
});

test("long snippets are capped", () => {
  const long = `${"word ".repeat(200)}rhythm. Next.`;
  assert.ok(bestSnippet(long, ["rhythm"]).length <= 400);
});
