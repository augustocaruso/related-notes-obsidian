import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PUBLIC_SURFACE_FILES = [
  "src/main.ts",
  "src/settings.ts",
  "src/ui/RelatedNotesView.ts",
  "README.md",
];

test("public UI exposes update-index language instead of reindex-vault language", () => {
  const publicSurface = PUBLIC_SURFACE_FILES
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert.doesNotMatch(publicSurface, /reindex-vault/i);
  assert.doesNotMatch(publicSurface, /Reindex vault/i);
  assert.doesNotMatch(publicSurface, /Reindex Vault/i);
  assert.doesNotMatch(publicSurface, /Reindex profile/i);

  assert.match(publicSurface, /update-index/);
  assert.match(publicSurface, /Update index/);
  assert.match(publicSurface, /new and changed notes/i);
});
