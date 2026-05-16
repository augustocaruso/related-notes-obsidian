import assert from "node:assert/strict";
import test from "node:test";
import { IndexingCancelledError, VaultIndexer } from "../../src/indexing/VaultIndexer";
import { sha256 } from "../../src/indexing/hash";
import { buildNoteRepresentation } from "../../src/indexing/noteRepresentation";

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
    listIndexedPaths: async (profileId: string) => {
      assert.equal(profileId, "clean_v1");
      return ["A.md", "Folder/C.md"];
    },
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
  const result = await indexer.indexMissingNotes("clean_v1", (current, total) => progress.push([current, total]));

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

  await indexer.indexMissingNotes("clean_v1");

  assert.deepEqual(sleepCalls, [25]);
});

test("indexMissingNotes treats missing notes per profile instead of per path globally", async () => {
  const files = [makeFile("A.md", "# A"), makeFile("B.md", "# B")];
  const upserted: Array<{ path: string; profile: string }> = [];
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      read: async (file: { markdown: string }) => file.markdown,
    },
  };
  const store = {
    listIndexedPaths: async (profileId: string) => profileId === "clean_v1" ? ["A.md"] : ["A.md", "B.md"],
    upsertNote: async (record: { path: string; embeddingProfile: string }) => {
      upserted.push({ path: record.path, profile: record.embeddingProfile });
    },
    flush: async () => undefined,
  };
  const embeddingProvider = {
    model: "test-model",
    apiKey: "test-key",
    embed: async () => [0.1, 0.2, 0.3],
  };

  const indexer = new VaultIndexer(app as any, store as any, embeddingProvider as any);
  const result = await indexer.indexMissingNotes("clean_v1");

  assert.deepEqual(upserted, [{ path: "B.md", profile: "clean_v1" }]);
  assert.equal(result.indexedCount, 1);
});

test("reindexVault skips clean_v1 embedding when only raw markdown scaffolding changed", async () => {
  const oldMarkdown = `---
tags:
  - old
---
# HAS

Texto principal.

## 🔗 Notas Relacionadas
- [[DRC]]
`;
  const newMarkdown = `---
tags:
  - new
aliases:
  - Hipertensão
---
# HAS

Texto principal.

## 🔗 Notas Relacionadas
- [[Diabetes]]
- [[AVC]]
`;
  const built = buildNoteRepresentation({
    path: "HAS.md",
    title: "HAS",
    markdown: oldMarkdown,
    profileId: "clean_v1",
  });
  const nextBuilt = buildNoteRepresentation({
    path: "HAS.md",
    title: "HAS",
    markdown: newMarkdown,
    profileId: "clean_v1",
  });
  assert.equal(nextBuilt.representationHash, built.representationHash);

  let embedCalls = 0;
  let upsertCalls = 0;
  const app = {
    vault: {
      getMarkdownFiles: () => [makeFile("HAS.md", newMarkdown)],
      read: async (file: { markdown: string }) => file.markdown,
    },
  };
  const store = {
    listIndexedPaths: async () => ["HAS.md"],
    getNote: async () => ({
      path: "HAS.md",
      title: "HAS",
      folder: "",
      preview: "Texto principal.",
      rawContentHash: sha256(oldMarkdown),
      representationHash: built.representationHash,
      contentHash: built.representationHash,
      mtime: 1,
      embeddingModel: "test-model",
      embeddingProfile: "clean_v1",
      embeddingProfileVersion: built.profileVersion,
      vector: [0.1, 0.2, 0.3],
      updatedAt: 1,
    }),
    upsertNote: async () => {
      upsertCalls++;
    },
    deleteNote: async () => undefined,
    flush: async () => undefined,
  };
  const embeddingProvider = {
    model: "test-model",
    apiKey: "test-key",
    embed: async () => {
      embedCalls++;
      return [0.4, 0.5, 0.6];
    },
  };

  const indexer = new VaultIndexer(app as any, store as any, embeddingProvider as any);
  await indexer.reindexVault("clean_v1");

  assert.equal(embedCalls, 0);
  assert.equal(upsertCalls, 0);
});

test("reindexVault skips clean_v1 embedding when only TOML frontmatter and Chat Original footer changed", async () => {
  const oldMarkdown = `+++
tags = ["old"]
+++
# Choque

Texto principal.

---
[Chat Original](https://gemini.google.com/app/old)
`;
  const newMarkdown = `+++
tags = ["new"]
aliases = ["Choque circulatório"]
+++
# Choque

Texto principal.

---
[Chat Original](https://gemini.google.com/app/new)
`;
  const built = buildNoteRepresentation({
    path: "Choque.md",
    title: "Choque",
    markdown: oldMarkdown,
    profileId: "clean_v1",
  });
  const nextBuilt = buildNoteRepresentation({
    path: "Choque.md",
    title: "Choque",
    markdown: newMarkdown,
    profileId: "clean_v1",
  });
  assert.equal(nextBuilt.representationHash, built.representationHash);

  let embedCalls = 0;
  let upsertCalls = 0;
  const app = {
    vault: {
      getMarkdownFiles: () => [makeFile("Choque.md", newMarkdown)],
      read: async (file: { markdown: string }) => file.markdown,
    },
  };
  const store = {
    listIndexedPaths: async () => ["Choque.md"],
    getNote: async () => ({
      path: "Choque.md",
      title: "Choque",
      folder: "",
      preview: "Texto principal.",
      rawContentHash: sha256(oldMarkdown),
      representationHash: built.representationHash,
      contentHash: built.representationHash,
      mtime: 1,
      embeddingModel: "test-model",
      embeddingProfile: "clean_v1",
      embeddingProfileVersion: built.profileVersion,
      vector: [0.1, 0.2, 0.3],
      updatedAt: 1,
    }),
    upsertNote: async () => {
      upsertCalls++;
    },
    deleteNote: async () => undefined,
    flush: async () => undefined,
  };
  const embeddingProvider = {
    model: "test-model",
    apiKey: "test-key",
    embed: async () => {
      embedCalls++;
      return [0.4, 0.5, 0.6];
    },
  };

  const indexer = new VaultIndexer(app as any, store as any, embeddingProvider as any);
  await indexer.reindexVault("clean_v1");

  assert.equal(embedCalls, 0);
  assert.equal(upsertCalls, 0);
});

test("reindexVault stops before the next note when cancellation is requested", async () => {
  const files = [makeFile("A.md", "# A"), makeFile("B.md", "# B"), makeFile("C.md", "# C")];
  const controller = new AbortController();
  const embedded: string[] = [];
  const upserted: string[] = [];
  let flushCalls = 0;
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      read: async (file: { markdown: string }) => file.markdown,
    },
  };
  const store = {
    listIndexedPaths: async () => [],
    getNote: async () => null,
    upsertNote: async (record: { path: string }) => {
      upserted.push(record.path);
    },
    deleteNote: async () => undefined,
    flush: async () => {
      flushCalls++;
    },
  };
  const embeddingProvider = {
    model: "test-model",
    apiKey: "test-key",
    embed: async (representation: string) => {
      embedded.push(representation);
      controller.abort();
      return [0.1, 0.2, 0.3];
    },
  };

  const indexer = new VaultIndexer(app as any, store as any, embeddingProvider as any);

  await assert.rejects(
    () => indexer.reindexVault("clean_v1", undefined, { signal: controller.signal }),
    IndexingCancelledError,
  );

  assert.equal(embedded.length, 1);
  assert.deepEqual(upserted, ["A.md"]);
  assert.equal(flushCalls > 0, true);
});

test("indexMissingNotes stops before the next missing note when cancellation is requested", async () => {
  const files = [makeFile("A.md", "# A"), makeFile("B.md", "# B"), makeFile("C.md", "# C")];
  const controller = new AbortController();
  const upserted: string[] = [];
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      read: async (file: { markdown: string }) => file.markdown,
    },
  };
  const store = {
    listIndexedPaths: async () => [],
    upsertNote: async (record: { path: string }) => {
      upserted.push(record.path);
    },
    flush: async () => undefined,
  };
  const embeddingProvider = {
    model: "test-model",
    apiKey: "test-key",
    embed: async () => {
      controller.abort();
      return [0.1, 0.2, 0.3];
    },
  };

  const indexer = new VaultIndexer(app as any, store as any, embeddingProvider as any);

  await assert.rejects(
    () => indexer.indexMissingNotes("clean_v1", undefined, { signal: controller.signal }),
    IndexingCancelledError,
  );

  assert.deepEqual(upserted, ["A.md"]);
});
