import assert from "node:assert/strict";
import test from "node:test";
import { compareProfileResults } from "../../src/ui/profileComparison";

test("compareProfileResults groups overlap, one-sided results, and rank changes", () => {
  const comparison = compareProfileResults(
    [
      { path: "A.md", title: "A", score: 0.95 },
      { path: "B.md", title: "B", score: 0.9 },
      { path: "C.md", title: "C", score: 0.8 },
      { path: "D.md", title: "D", score: 0.7 },
    ],
    [
      { path: "C.md", title: "C", score: 0.93 },
      { path: "A.md", title: "A", score: 0.91 },
      { path: "E.md", title: "E", score: 0.88 },
      { path: "B.md", title: "B", score: 0.65 },
    ],
  );

  assert.deepEqual(comparison.both.map((item) => item.path), ["A.md", "C.md", "B.md"]);
  assert.deepEqual(comparison.leftOnly.map((item) => item.path), ["D.md"]);
  assert.deepEqual(comparison.rightOnly.map((item) => item.path), ["E.md"]);
  assert.deepEqual(comparison.rankChanged.map((item) => item.path), ["C.md", "B.md"]);
  assert.equal(comparison.both[0].scoreDelta, -0.04);
});
