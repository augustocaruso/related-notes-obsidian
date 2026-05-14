# Workbench Related Notes Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this Obsidian plugin automatically produce the stable `medical-notes-workbench.related-notes-export.v1` artifact consumed by Medical Notes Workbench.

**Architecture:** Keep `index.json` as the private vector cache. Add a separate redacted export layer that reads indexed records, computes raw Markdown file hashes from the vault, computes related-note edges from the existing similarity service, and writes `.obsidian/plugins/related-notes-obsidian/medical-notes-export.json`. The Workbench export must never include vectors, previews, API keys, raw Markdown, note bodies, or internal plugin cache state.

**Tech Stack:** Obsidian plugin API, TypeScript, Node test runner, existing `JsonVectorStore`, existing `RelatedNotesService`, existing `sha256()` helper, `npm test`, `npm run build`.

---

## Context

Medical Notes Workbench already expects this export path by default:

```text
.obsidian/plugins/related-notes-obsidian/medical-notes-export.json
```

Expected schema:

```json
{
  "schema": "medical-notes-workbench.related-notes-export.v1",
  "generated_at": "2026-05-14T00:00:00.000Z",
  "vault_root": "/absolute/path/to/Wiki_Medicina",
  "plugin": {"name": "related-notes-obsidian", "version": "0.1.0"},
  "score_scale": "0_to_1",
  "notes": [
    {
      "path": "Cardio/Infarto.md",
      "title": "Infarto",
      "content_hash": "sha256:<sha256-of-raw-markdown-file>"
    }
  ],
  "edges": [
    {
      "source_path": "Cardio/Infarto.md",
      "target_path": "Cardio/Troponina.md",
      "score": 0.91,
      "rank": 1,
      "source": "related-notes-obsidian"
    }
  ]
}
```

Current plugin facts:

- `src/store/JsonVectorStore.ts` writes private cache to `index.json`.
- `src/types.ts` defines `NoteVectorRecord` with `preview` and `vector`; both stay private.
- `src/main.ts` has commands for sidebar and reindex, but no Workbench export command.
- `src/related/RelatedNotesService.ts` computes related notes for one path from existing vectors.
- `src/indexing/hash.ts` already provides `sha256(text: string)`.
- `README.md` says not to commit `data.json`, `index.json`, or vault-derived exports.

## Non-Goals

- Do not make Medical Notes Workbench read `index.json`.
- Do not export vectors, previews, embeddings, API keys, raw Markdown, or note bodies.
- Do not call Gemini during export.
- Do not change the embedding representation or indexing algorithm.
- Do not write Markdown notes from the plugin.

## Privacy Contract

The export may contain:

- relative note path;
- note title;
- SHA-256 hash of the raw Markdown file;
- similarity score;
- rank;
- plugin name/version;
- vault root path.

The export must not contain these keys anywhere in the JSON tree:

```text
vector
preview
geminiApiKey
apiKey
api_key
markdown
content
body
rawMarkdown
raw_markdown
embedding
embeddings
```

The plugin may read Markdown in memory to compute `content_hash`, but must not persist note text or excerpts in the export.

## File Structure

- Create: `src/export/WorkbenchExport.ts`
  - Build and write the redacted Workbench export.
  - Keep privacy filtering here.
  - Keep pure payload-building helpers testable without Obsidian runtime.
- Modify: `src/main.ts`
  - Add a command to export manually.
  - Call export automatically after successful `reindexVault()`.
  - Call export automatically after successful `indexCurrentFile()`.
- Modify: `src/types.ts`
  - Add export payload types.
- Create: `tests/export/WorkbenchExport.test.ts`
  - Unit-test schema shape, ordering, raw hash contract, and privacy redaction.
- Modify: `README.md`
  - Document the Workbench export behavior and privacy contract.

## Task 1: Add Export Types

**Files:**

- Modify: `src/types.ts`

- [ ] **Step 1: Add types**

Append to `src/types.ts`:

```ts
export type WorkbenchRelatedNote = {
  path: string;
  title: string;
  content_hash: string;
};

export type WorkbenchRelatedEdge = {
  source_path: string;
  target_path: string;
  score: number;
  rank: number;
  source: "related-notes-obsidian";
};

export type WorkbenchRelatedNotesExport = {
  schema: "medical-notes-workbench.related-notes-export.v1";
  generated_at: string;
  vault_root: string;
  plugin: {
    name: string;
    version: string;
  };
  score_scale: "0_to_1";
  notes: WorkbenchRelatedNote[];
  edges: WorkbenchRelatedEdge[];
};
```

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit --author="Codex <codex@openai.com>" -m "types: add workbench export payload"
```

## Task 2: Add Pure Export Builder And Privacy Tests

**Files:**

- Create: `src/export/WorkbenchExport.ts`
- Create: `tests/export/WorkbenchExport.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/export/WorkbenchExport.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkbenchExportPayload, assertWorkbenchExportIsRedacted } from "../../src/export/WorkbenchExport";

test("buildWorkbenchExportPayload creates notes and ordered edges without private fields", () => {
  const payload = buildWorkbenchExportPayload({
    generatedAt: "2026-05-14T00:00:00.000Z",
    vaultRoot: "/vault/Wiki_Medicina",
    pluginName: "related-notes-obsidian",
    pluginVersion: "0.1.0",
    notes: [
      { path: "A.md", title: "A", contentHash: "sha256:a" },
      { path: "B.md", title: "B", contentHash: "sha256:b" },
      { path: "C.md", title: "C", contentHash: "sha256:c" }
    ],
    relatedBySource: new Map([
      [
        "A.md",
        [
          { path: "C.md", title: "C", score: 0.91, vector: [1, 2], preview: "private preview" },
          { path: "B.md", title: "B", score: 0.95, vector: [3, 4], preview: "private preview" }
        ]
      ]
    ])
  });

  assert.equal(payload.schema, "medical-notes-workbench.related-notes-export.v1");
  assert.deepEqual(payload.notes, [
    { path: "A.md", title: "A", content_hash: "sha256:a" },
    { path: "B.md", title: "B", content_hash: "sha256:b" },
    { path: "C.md", title: "C", content_hash: "sha256:c" }
  ]);
  assert.deepEqual(payload.edges, [
    { source_path: "A.md", target_path: "B.md", score: 0.95, rank: 1, source: "related-notes-obsidian" },
    { source_path: "A.md", target_path: "C.md", score: 0.91, rank: 2, source: "related-notes-obsidian" }
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
        vector: [1, 2, 3]
      } as any),
    /private key/i
  );
});
```

- [ ] **Step 2: Verify failure**

Run:

```bash
npm test
```

Expected: fail because `src/export/WorkbenchExport.ts` does not exist.

- [ ] **Step 3: Implement pure builder**

Create `src/export/WorkbenchExport.ts`:

```ts
import type {
  WorkbenchRelatedEdge,
  WorkbenchRelatedNote,
  WorkbenchRelatedNotesExport
} from "../types";

type ExportNoteInput = {
  path: string;
  title: string;
  contentHash: string;
};

type RelatedInput = {
  path: string;
  title: string;
  score: number;
};

export type BuildWorkbenchExportPayloadInput = {
  generatedAt: string;
  vaultRoot: string;
  pluginName: string;
  pluginVersion: string;
  notes: ExportNoteInput[];
  relatedBySource: Map<string, RelatedInput[]>;
};

const FORBIDDEN_KEYS = new Set([
  "vector",
  "preview",
  "geminiApiKey",
  "apiKey",
  "api_key",
  "markdown",
  "content",
  "body",
  "rawMarkdown",
  "raw_markdown",
  "embedding",
  "embeddings"
]);

export function buildWorkbenchExportPayload(
  input: BuildWorkbenchExportPayloadInput
): WorkbenchRelatedNotesExport {
  const notes: WorkbenchRelatedNote[] = [...input.notes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((note) => ({
      path: note.path,
      title: note.title,
      content_hash: normalizeSha256(note.contentHash)
    }));

  const notePaths = new Set(notes.map((note) => note.path));
  const edges: WorkbenchRelatedEdge[] = [];

  for (const source of notes) {
    const related = [...(input.relatedBySource.get(source.path) ?? [])]
      .filter((candidate) => candidate.path !== source.path)
      .filter((candidate) => notePaths.has(candidate.path))
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    related.forEach((candidate, index) => {
      edges.push({
        source_path: source.path,
        target_path: candidate.path,
        score: clampScore(candidate.score),
        rank: index + 1,
        source: "related-notes-obsidian"
      });
    });
  }

  const payload: WorkbenchRelatedNotesExport = {
    schema: "medical-notes-workbench.related-notes-export.v1",
    generated_at: input.generatedAt,
    vault_root: input.vaultRoot,
    plugin: {
      name: input.pluginName,
      version: input.pluginVersion
    },
    score_scale: "0_to_1",
    notes,
    edges
  };

  assertWorkbenchExportIsRedacted(payload);
  return payload;
}

export function assertWorkbenchExportIsRedacted(value: unknown): void {
  const path = findForbiddenKey(value);
  if (path) {
    throw new Error(`Workbench export contains private key: ${path}`);
  }
}

function normalizeSha256(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("sha256:") ? trimmed : `sha256:${trimmed}`;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function findForbiddenKey(value: unknown, prefix = ""): string {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findForbiddenKey(value[i], `${prefix}[${i}]`);
      if (found) return found;
    }
    return "";
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (FORBIDDEN_KEYS.has(key)) return path;
      const found = findForbiddenKey(item, path);
      if (found) return found;
    }
  }
  return "";
}
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/export/WorkbenchExport.ts tests/export/WorkbenchExport.test.ts
git commit --author="Codex <codex@openai.com>" -m "export: add redacted workbench payload builder"
```

## Task 3: Write Export From Obsidian Vault

**Files:**

- Modify: `src/export/WorkbenchExport.ts`

- [ ] **Step 1: Add runtime writer**

Extend `src/export/WorkbenchExport.ts`:

```ts
import type { App, Plugin, TFile } from "obsidian";
import { sha256 } from "../indexing/hash";
import type { RelatedNotesService } from "../related/RelatedNotesService";
import type { NoteVectorStore } from "../store/NoteVectorStore";

export const WORKBENCH_EXPORT_PATH = "medical-notes-export.json";

export type WriteWorkbenchExportOptions = {
  app: App;
  plugin: Plugin;
  store: NoteVectorStore;
  service: RelatedNotesService;
  limit: number;
};

export async function writeWorkbenchExport(options: WriteWorkbenchExportOptions): Promise<{
  path: string;
  noteCount: number;
  edgeCount: number;
}> {
  const indexedPaths = await options.store.listIndexedPaths();
  const exportNotes: ExportNoteInput[] = [];
  const relatedBySource = new Map<string, RelatedInput[]>();

  for (const path of indexedPaths.sort()) {
    const file = options.app.vault.getAbstractFileByPath(path);
    if (!isMarkdownFile(file)) continue;

    const record = await options.store.getNote(path);
    if (!record) continue;

    const markdown = await options.app.vault.read(file);
    exportNotes.push({
      path: file.path,
      title: file.basename,
      contentHash: `sha256:${sha256(markdown)}`
    });

    const result = await options.service.getRelatedNotes(file.path, options.limit);
    relatedBySource.set(
      file.path,
      result.status === "ok"
        ? result.notes.map((note) => ({ path: note.path, title: note.title, score: note.score }))
        : []
    );
  }

  const payload = buildWorkbenchExportPayload({
    generatedAt: new Date().toISOString(),
    vaultRoot: getVaultRoot(options.app),
    pluginName: options.plugin.manifest.id,
    pluginVersion: options.plugin.manifest.version,
    notes: exportNotes,
    relatedBySource
  });

  const path = `${options.app.vault.configDir}/plugins/${options.plugin.manifest.id}/${WORKBENCH_EXPORT_PATH}`;
  await options.app.vault.adapter.write(path, JSON.stringify(payload, null, 2));
  return { path, noteCount: payload.notes.length, edgeCount: payload.edges.length };
}

function isMarkdownFile(file: any): file is TFile {
  return Boolean(file && typeof file.path === "string" && file.extension === "md");
}

function getVaultRoot(app: App): string {
  const adapter = app.vault.adapter as any;
  if (typeof adapter.getBasePath === "function") return adapter.getBasePath();
  if (typeof adapter.basePath === "string") return adapter.basePath;
  return "";
}
```

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/export/WorkbenchExport.ts
git commit --author="Codex <codex@openai.com>" -m "export: write workbench artifact from vault"
```

## Task 4: Wire Manual And Automatic Export Commands

**Files:**

- Modify: `src/main.ts`
- Modify: `README.md`

- [ ] **Step 1: Import exporter**

At the top of `src/main.ts`, add:

```ts
import { writeWorkbenchExport } from "./export/WorkbenchExport";
```

- [ ] **Step 2: Add manual command**

In `onload()`, after the `reindex-vault` command, add:

```ts
    this.addCommand({
      id: "export-workbench-related-notes",
      name: "Export Medical Notes Workbench related notes",
      callback: () => this.exportWorkbenchRelatedNotes()
    });
```

- [ ] **Step 3: Add export method**

In `RelatedNotesPlugin`, add:

```ts
  async exportWorkbenchRelatedNotes() {
    try {
      const result = await writeWorkbenchExport({
        app: this.app,
        plugin: this,
        store: this.store,
        service: this.service,
        limit: this.settings.relatedNotesLimit
      });
      new Notice(`Workbench export ready: ${result.noteCount} notes, ${result.edgeCount} edges.`);
      console.log("[RelatedNotes] Workbench export written:", result);
    } catch (e) {
      console.error("[RelatedNotes] Workbench export failed:", e);
      new Notice("Workbench export failed. See console for details.");
    }
  }
```

- [ ] **Step 4: Export automatically after full reindex**

In `reindexVault()`, after:

```ts
        this.updateSidebar(this.app.workspace.getActiveFile());
```

add:

```ts
        await this.exportWorkbenchRelatedNotes();
```

- [ ] **Step 5: Export automatically after current file indexing**

In `indexCurrentFile()`, after:

```ts
      this.updateSidebar(target);
```

add:

```ts
      await this.exportWorkbenchRelatedNotes();
```

This is intentionally vault-level export after a single note changes. A new or modified vector can become a strong candidate for many other source notes, so exporting only the current note would produce a stale graph.

- [ ] **Step 6: Document README**

Add:

~~~md
## Medical Notes Workbench Export

After a successful vault reindex or current-note index, the plugin automatically writes:

```text
.obsidian/plugins/related-notes-obsidian/medical-notes-export.json
```

This file is the stable redacted artifact consumed by Medical Notes Workbench. It contains note paths, titles, raw Markdown SHA-256 hashes, related-note scores and ranks. It does not contain vectors, previews, API keys, raw Markdown, note bodies, or plugin cache internals.

You can force regeneration from the Obsidian command palette:

```text
Related Notes: Export Medical Notes Workbench related notes
```
~~~

- [ ] **Step 7: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts README.md
git commit --author="Codex <codex@openai.com>" -m "export: automate workbench related notes export"
```

## Task 5: Integration Sanity Check Against Workbench Contract

**Files:**

- Modify only if validation reveals a mismatch.

- [ ] **Step 1: Confirm the generated file satisfies the Workbench contract**

Check:

```text
schema == medical-notes-workbench.related-notes-export.v1
notes[].path is relative to vault
notes[].title is note basename/title
notes[].content_hash is sha256:<raw markdown sha>
edges[].source_path exists in notes[]
edges[].target_path exists in notes[]
edges[].score is 0..1
edges[].rank starts at 1 per source note
no vector/preview/markdown/content/api key exists anywhere
```

- [ ] **Step 2: Compare against local Workbench parser if available**

If Medical Notes Workbench is available at `/Users/augustocaruso/Documents/medical-notes-workbench`, inspect:

```bash
rg -n "related-notes-export.v1|medical-notes-export.json|content_hash|source_path|target_path" /Users/augustocaruso/Documents/medical-notes-workbench/extension/scripts/mednotes/wiki/related_notes.py /Users/augustocaruso/Documents/medical-notes-workbench/tests/test_related_notes_sync.py
```

The plugin export must match the parser in `extension/scripts/mednotes/wiki/related_notes.py`.

- [ ] **Step 3: Run final verification**

Run:

```bash
npm test
npm run build
git status --short
```

Expected:

- tests pass;
- build passes;
- worktree contains only intentional source/doc changes;
- no generated vault export, `index.json`, or `data.json` is staged.

## Acceptance Criteria

- The plugin has a manual Obsidian command to export the Workbench artifact.
- The plugin automatically exports after successful full vault reindex.
- The plugin automatically exports after successful current-note indexing.
- Export path is `.obsidian/plugins/related-notes-obsidian/medical-notes-export.json`.
- Export schema is `medical-notes-workbench.related-notes-export.v1`.
- Export contains `notes[]` and `edges[]`.
- Export uses SHA-256 of raw Markdown file content for `content_hash`.
- Export never includes vectors, previews, API keys, raw Markdown, note body text, `index.json` contents, or `data.json` contents.
- `npm test` passes.
- `npm run build` passes.
- Changes are committed with Codex author.

## Suggested Final Commit

If implementing all tasks in one branch, final commit message:

```bash
git commit --author="Codex <codex@openai.com>" -m "feat: export workbench related notes artifact"
```

If using task-by-task commits, keep the task commit messages above.
