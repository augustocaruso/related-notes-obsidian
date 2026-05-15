import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWorkbenchExportIsRedacted,
  buildWorkbenchExportPayload,
  writeWorkbenchExport,
} from "../../src/export/WorkbenchExport";
import { sha256 } from "../../src/indexing/hash";

test("buildWorkbenchExportPayload creates notes and ordered edges without private fields", () => {
  const payload = buildWorkbenchExportPayload({
    generatedAt: "2026-05-14T00:00:00.000Z",
    vaultRoot: "/vault/Wiki_Medicina",
    pluginName: "related-notes-obsidian",
    pluginVersion: "0.1.0",
    profileId: "clean_v1",
    embeddingModel: "test-model",
    notes: [
      { path: "A.md", title: "A", contentHash: "sha256:a" },
      { path: "B.md", title: "B", contentHash: "sha256:b" },
      { path: "C.md", title: "C", contentHash: "sha256:c" },
    ],
    relatedBySource: new Map([
      [
        "A.md",
        [
          { path: "C.md", title: "C", score: 0.91, vector: [1, 2], preview: "private preview" },
          { path: "B.md", title: "B", score: 0.95, vector: [3, 4], preview: "private preview" },
        ],
      ],
    ]),
  });

  assert.equal(payload.schema, "medical-notes-workbench.related-notes-export.v1");
  assert.deepEqual(payload.model, {
    embedding_model: "test-model",
    embedding_profile_id: "clean_v1",
    embedding_profile_version: 1,
    representation_hash_basis: "profile_cleaned_markdown",
  });
  assert.deepEqual(payload.notes, [
    { path: "A.md", title: "A", content_hash: "sha256:a" },
    { path: "B.md", title: "B", content_hash: "sha256:b" },
    { path: "C.md", title: "C", content_hash: "sha256:c" },
  ]);
  assert.deepEqual(payload.edges, [
    { source_path: "A.md", target_path: "B.md", score: 0.95, rank: 1, source: "related-notes-obsidian" },
    { source_path: "A.md", target_path: "C.md", score: 0.91, rank: 2, source: "related-notes-obsidian" },
  ]);
  assertWorkbenchExportIsRedacted(payload);
  assert.equal(JSON.stringify(payload).includes("private preview"), false);
  assert.equal(JSON.stringify(payload).includes("vector"), false);
});

test("assertWorkbenchExportIsRedacted rejects private payload keys", () => {
  assert.throws(
    () =>
      assertWorkbenchExportIsRedacted({
        schema: "medical-notes-workbench.related-notes-export.v1",
        generated_at: "2026-05-14T00:00:00.000Z",
        vault_root: "/vault",
        plugin: { name: "related-notes-obsidian", version: "0.1.0" },
        score_scale: "0_to_1",
        notes: [],
        edges: [],
        vector: [1, 2, 3],
      } as any),
    /private key/i,
  );
});

test("writeWorkbenchExport writes redacted vault export with raw markdown hashes and configured limit", async () => {
  let writtenPath = "";
  let writtenText = "";
  let requestedLimit = 0;
  const files = new Map([
    ["Cardio/HAS.md", { path: "Cardio/HAS.md", basename: "HAS", extension: "md" }],
    ["Nefro/DRC.md", { path: "Nefro/DRC.md", basename: "DRC", extension: "md" }],
  ]);
  const markdown = new Map([
    ["Cardio/HAS.md", "# HAS\n\nTexto cru."],
    ["Nefro/DRC.md", "# DRC\n\nTexto cru."],
  ]);
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter: {
        basePath: "/vault/Wiki_Medicina",
        write: async (path: string, text: string) => {
          writtenPath = path;
          writtenText = text;
        },
      },
      getAbstractFileByPath: (path: string) => files.get(path),
      read: async (file: { path: string }) => markdown.get(file.path),
    },
  };
  const plugin = { manifest: { id: "related-notes-obsidian", version: "0.1.0" } };
  const store = {
    listIndexedPaths: async (profileId: string) => {
      assert.equal(profileId, "clean_v1");
      return ["Cardio/HAS.md", "Nefro/DRC.md"];
    },
    getNote: async (path: string, profileId: string) => ({ path, embeddingModel: "test-model", embeddingProfile: profileId }),
  };
  const service = {
    getRelatedNotes: async (path: string, limit: number, profileId: string) => {
      requestedLimit = limit;
      assert.equal(profileId, "clean_v1");
      return path === "Cardio/HAS.md"
        ? {
            status: "ok",
            notes: [
              {
                path: "Nefro/DRC.md",
                title: "DRC",
                score: 0.91,
                preview: "private preview",
                vector: [0.1, 0.2],
              },
            ],
          }
        : { status: "ok", notes: [] };
    },
  };

  const result = await writeWorkbenchExport({
    app: app as any,
    plugin: plugin as any,
    store: store as any,
    service: service as any,
    limit: 7,
    profileId: "clean_v1",
  });

  const payload = JSON.parse(writtenText);
  assert.equal(requestedLimit, 7);
  assert.equal(result.path, ".obsidian/plugins/related-notes-obsidian/medical-notes-export.json");
  assert.equal(writtenPath, result.path);
  assert.equal(payload.notes[0].content_hash, `sha256:${sha256("# HAS\n\nTexto cru.")}`);
  assert.equal(payload.model.embedding_profile_id, "clean_v1");
  assert.deepEqual(payload.edges, [
    {
      source_path: "Cardio/HAS.md",
      target_path: "Nefro/DRC.md",
      score: 0.91,
      rank: 1,
      source: "related-notes-obsidian",
    },
  ]);
  assert.equal(JSON.stringify(payload).includes("private preview"), false);
  assert.equal(JSON.stringify(payload).includes("vector"), false);
});
