import assert from "node:assert/strict";
import test from "node:test";
import { JsonVectorStore } from "../../src/store/JsonVectorStore";
import type { NoteVectorRecord } from "../../src/types";

function makePlugin(initialIndex: unknown = null) {
  const writes: Record<string, string> = {};
  const storagePath = ".obsidian/plugins/related-notes-obsidian/index.json";
  const reads: Record<string, string> = initialIndex === null
    ? {}
    : { [storagePath]: JSON.stringify(initialIndex, null, 2) };

  return {
    writes,
    storagePath,
    plugin: {
      manifest: { id: "related-notes-obsidian" },
      app: {
        vault: {
          configDir: ".obsidian",
          adapter: {
            exists: async (path: string) => Object.prototype.hasOwnProperty.call(reads, path),
            read: async (path: string) => reads[path],
            write: async (path: string, content: string) => {
              writes[path] = content;
              reads[path] = content;
            },
          },
        },
      },
    } as any,
  };
}

function makeRecord(path: string, profile: "clean_v1" | "raw_v1"): NoteVectorRecord {
  return {
    path,
    title: path.replace(/\.md$/, ""),
    folder: "",
    preview: "preview",
    rawContentHash: `raw-${path}`,
    representationHash: `${profile}-${path}`,
    contentHash: `${profile}-${path}`,
    mtime: 1,
    embeddingModel: "test-model",
    embeddingProfile: profile,
    embeddingProfileVersion: 1,
    vector: profile === "clean_v1" ? [1, 0] : [0, 1],
    updatedAt: 1,
  };
}

test("JsonVectorStore migrates path-keyed v1 index into legacy_v0", async () => {
  const { plugin } = makePlugin({
    "A.md": {
      path: "A.md",
      title: "A",
      folder: "",
      preview: "old",
      contentHash: "old-representation-hash",
      mtime: 1,
      embeddingModel: "test-model",
      vector: [1, 0],
      updatedAt: 1,
    },
  });

  const store = new JsonVectorStore(plugin);
  await store.init();

  assert.equal(await store.getNote("A.md", "clean_v1"), null);
  const legacy = await store.getNote("A.md", "legacy_v0");
  assert.equal(legacy?.embeddingProfile, "legacy_v0");
  assert.equal(legacy?.representationHash, "old-representation-hash");
  assert.deepEqual(await store.listStoredProfiles(), ["legacy_v0"]);
});

test("JsonVectorStore scopes reads, search, and clear operations by profile", async () => {
  const { plugin } = makePlugin();
  const store = new JsonVectorStore(plugin);
  await store.init();

  await store.upsertNotes([
    makeRecord("A.md", "clean_v1"),
    makeRecord("B.md", "clean_v1"),
    makeRecord("A.md", "raw_v1"),
  ]);

  assert.equal((await store.getNote("A.md", "clean_v1"))?.embeddingProfile, "clean_v1");
  assert.equal((await store.getNote("A.md", "raw_v1"))?.embeddingProfile, "raw_v1");
  assert.deepEqual(await store.listIndexedPaths("clean_v1"), ["A.md", "B.md"]);
  assert.deepEqual(await store.listIndexedPaths("raw_v1"), ["A.md"]);

  const cleanResults = await store.searchSimilar([1, 0], { limit: 10, profileId: "clean_v1" });
  assert.deepEqual(cleanResults.map((record) => record.path), ["A.md", "B.md"]);

  await store.clearProfile("clean_v1");
  assert.deepEqual(await store.listIndexedPaths("clean_v1"), []);
  assert.deepEqual(await store.listIndexedPaths("raw_v1"), ["A.md"]);

  await store.clearAllProfiles();
  assert.deepEqual(await store.listStoredProfiles(), []);
});
