import assert from "node:assert/strict";
import test from "node:test";
import { VaultIndexer } from "../../src/indexing/VaultIndexer";

function makeFile(path: string, markdown: string) {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  return {
    path,
    basename,
    extension: "md",
    parent: { path: path.includes("/") ? path.split("/").slice(0, -1).join("/") : "" },
    stat: { mtime: 123 },
    markdown,
  };
}

test("indexMissingNotes embeds only notes absent from the local index", async () => {
  const files = [
    makeFile("A.md", "# A"),
    makeFile("B.md", "# B"),
    makeFile("Folder/C.md", "# C"),
  ];
  const readPaths: string[] = [];
  const embeddedRepresentations: string[] = [];
  const upsertedPaths: string[] = [];
  const progress: Array<[number, number]> = [];
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      read: async (file: { path: string; markdown: string }) => {
        readPaths.push(file.path);
        return file.markdown;
      },
    },
  };
  const store = {
    listIndexedPaths: async () => ["A.md", "Folder/C.md"],
    upsertNote: async (record: { path: string }) => {
      upsertedPaths.push(record.path);
    },
    flush: async () => undefined,
  };
  const embeddingProvider = {
    model: "test-model",
    apiKey: "test-key",
    embed: async (representation: string) => {
      embeddedRepresentations.push(representation);
      return [0.1, 0.2, 0.3];
    },
  };

  const indexer = new VaultIndexer(app as any, store as any, embeddingProvider as any);
  const result = await indexer.indexMissingNotes((current, total) => progress.push([current, total]));

  assert.deepEqual(readPaths, ["B.md"]);
  assert.deepEqual(upsertedPaths, ["B.md"]);
  assert.equal(embeddedRepresentations.length, 1);
  assert.equal(embeddedRepresentations[0].includes("Título: B"), true);
  assert.deepEqual(progress, [[1, 1]]);
  assert.deepEqual(result, { totalCount: 3, indexedCount: 1, skippedCount: 2 });
});

test("indexMissingNotes uses configured delay instead of a hardcoded five second sleep", async () => {
  const files = [makeFile("A.md", "# A"), makeFile("B.md", "# B")];
  const sleepCalls: number[] = [];
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      read: async (file: { markdown: string }) => file.markdown,
    },
  };
  const store = {
    listIndexedPaths: async () => [],
    upsertNote: async () => undefined,
    flush: async () => undefined,
  };
  const embeddingProvider = {
    model: "test-model",
    apiKey: "test-key",
    embed: async () => [0.1, 0.2, 0.3],
  };

  const indexer = new VaultIndexer(app as any, store as any, embeddingProvider as any, {
    embeddingRequestDelayMs: 25,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    },
  });

  await indexer.indexMissingNotes();

  assert.deepEqual(sleepCalls, [25]);
});
