# Embedding Profiles Settings Implementation Handoff

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add profile-aware embedding management to the Obsidian Related Notes plugin so `clean_v1` becomes the active default for indexing and Workbench export, while other stored profiles remain available for sidebar comparison.

**Architecture:** The plugin should treat an embedding profile as an explicit part of the vector cache key, settings state, sidebar state, and Workbench export metadata. The default profile selected in settings is the active profile used by normal indexing commands, related-note lookup, and `medical-notes-export.json`; additional stored profiles are local comparison material only.

**Tech Stack:** Obsidian plugin TypeScript, existing Gemini embedding provider, JSON vector store at `.obsidian/plugins/related-notes-obsidian/index.json`, Node test runner.

---

## Product Decisions Already Closed

- The default profile in settings is the active target for indexing, related-note lookup, and Workbench export.
- `clean_v1` is the new default profile.
- `raw_v1` must be available and storable for comparison, but it is not the default.
- The sidebar must be able to view stored profiles and compare two stored profiles.
- The Workbench consumes only the active/default profile export.
- This slice must not change the embedding model.
- This slice must not change the empirical high-relevance threshold policy already used downstream; the Workbench can keep treating scores above about `0.78` as strong.
- `clean_v1` removes noisy non-semantic note scaffolding before embedding, but preserves code blocks and Markdown tables.
- Stored vectors are local plugin internals and must not be exported to the Workbench.

## Current State Of The Plugin

Relevant files:

- `src/types.ts`
  - Current `RelatedNotesSettings` has only `geminiApiKey`, `relatedNotesLimit`, and `embeddingRequestDelayMs`.
  - Current `NoteVectorRecord` has no profile identity.
  - Current `WorkbenchRelatedNotesExport` has no profile metadata.

- `src/indexing/noteRepresentation.ts`
  - Current `cleanMarkdown()` removes YAML frontmatter.
  - It replaces fenced code blocks with `[CODE BLOCK]`.
  - It rewrites Wikilinks and Markdown links to visible text.
  - It collapses whitespace.
  - This is neither true `raw_v1` nor final `clean_v1`, because final `clean_v1` must preserve code blocks and tables.

- `src/indexing/VaultIndexer.ts`
  - `reindexVault()` scans all Markdown files.
  - `indexMissingNotes()` only embeds paths absent from the current store.
  - `indexFile()` embeds one file.
  - All three call `buildNoteRepresentation()` without a profile argument.

- `src/store/JsonVectorStore.ts`
  - Stores one `Map<string, NoteVectorRecord>` keyed only by note path.
  - Persists directly to `.obsidian/plugins/<plugin-id>/index.json`.
  - `searchSimilar()` searches the whole single map.

- `src/related/RelatedNotesService.ts`
  - Gets current note from store by path.
  - Searches similar records in the same store.
  - Has no profile parameter.

- `src/ui/RelatedNotesView.ts`
  - Shows one related-note list for the active file.
  - Toolbar buttons call `indexCurrentFile`, `indexMissingNotes`, `reindexVault`, and settings.
  - No profile selector or compare mode exists.

- `src/settings.ts`
  - Settings UI exposes API key, sidebar limit, request delay, index missing, reindex, and clear index.
  - No profile management controls exist.

- `src/export/WorkbenchExport.ts`
  - Writes `.obsidian/plugins/related-notes-obsidian/medical-notes-export.json`.
  - Export is redacted and contains no vectors, previews, API key, raw Markdown, or cache internals.
  - It currently lists all indexed paths from the single store.

## Important Migration Constraint

Do not silently relabel existing `index.json` vectors as `raw_v1` or `clean_v1`.

Reason: the current representation is a legacy hybrid. It already strips frontmatter and links, but it also removes code blocks. That behavior is not the desired `raw_v1` and not the desired `clean_v1`.

Required behavior:

- If an old one-profile `index.json` exists, migrate it into a non-default `legacy_v0` profile or mark it as legacy metadata.
- The new default `clean_v1` should be considered missing/stale until indexed.
- `raw_v1` should be generated only by an explicit raw profile index pass.
- The migration must preserve old data for safety, but normal default lookup/export must move to `clean_v1`.

## Embedding Profile Contract

Create explicit profile definitions. A practical shape:

```ts
export type EmbeddingProfileId = "clean_v1" | "raw_v1" | "legacy_v0";

export type EmbeddingProfileDefinition = {
  id: EmbeddingProfileId;
  version: 1;
  label: string;
  description: string;
  includeTitle: boolean;
  includePath: boolean;
  transform: "clean_v1" | "raw_v1" | "legacy_v0";
};

export const EMBEDDING_PROFILES: Record<EmbeddingProfileId, EmbeddingProfileDefinition> = {
  clean_v1: {
    id: "clean_v1",
    version: 1,
    label: "Clean v1",
    description: "Removes generated scaffolding and embeds the semantic note body.",
    includeTitle: true,
    includePath: true,
    transform: "clean_v1",
  },
  raw_v1: {
    id: "raw_v1",
    version: 1,
    label: "Raw v1",
    description: "Embeds title, path, and raw Markdown for comparison.",
    includeTitle: true,
    includePath: true,
    transform: "raw_v1",
  },
  legacy_v0: {
    id: "legacy_v0",
    version: 1,
    label: "Legacy v0",
    description: "Pre-profile vectors migrated from the original plugin cache.",
    includeTitle: true,
    includePath: true,
    transform: "legacy_v0",
  },
};
```

`legacy_v0` is for migration and inspection only. It should not appear as the recommended default.

## Settings Contract

Extend `RelatedNotesSettings` with profile controls:

```ts
export interface RelatedNotesSettings {
  geminiApiKey: string;
  relatedNotesLimit: number;
  embeddingRequestDelayMs: number;
  defaultEmbeddingProfile: EmbeddingProfileId;
  storedEmbeddingProfiles: EmbeddingProfileId[];
  sidebarProfileMode: "default" | "single" | "compare";
  sidebarSelectedProfile: EmbeddingProfileId;
  sidebarCompareLeftProfile: EmbeddingProfileId;
  sidebarCompareRightProfile: EmbeddingProfileId;
}
```

Default settings:

```ts
export const DEFAULT_SETTINGS: RelatedNotesSettings = {
  geminiApiKey: "",
  relatedNotesLimit: 10,
  embeddingRequestDelayMs: 0,
  defaultEmbeddingProfile: "clean_v1",
  storedEmbeddingProfiles: ["clean_v1", "raw_v1"],
  sidebarProfileMode: "default",
  sidebarSelectedProfile: "clean_v1",
  sidebarCompareLeftProfile: "clean_v1",
  sidebarCompareRightProfile: "raw_v1",
};
```

Validation rules in `loadSettings()`:

- `defaultEmbeddingProfile` must be a known non-legacy profile; if invalid, reset to `clean_v1`.
- `storedEmbeddingProfiles` must include the default profile.
- `storedEmbeddingProfiles` may include `raw_v1`; it should not include unknown ids.
- `legacy_v0` may be shown only when migrated data exists.
- Compare left/right must be known stored profiles; fallback to `clean_v1` and `raw_v1`.

## Representation Rules

Implement profile-aware representation builders in `src/indexing/noteRepresentation.ts`.

Recommended API:

```ts
export function buildNoteRepresentation(input: {
  path: string;
  title: string;
  markdown: string;
  profileId: EmbeddingProfileId;
}): {
  text: string;
  representationHash: string;
  profileId: EmbeddingProfileId;
  profileVersion: number;
};
```

### `raw_v1`

Use title and path plus raw Markdown, truncated at the same embedding limit.

Expected behavior:

- Preserve YAML/frontmatter.
- Preserve footer.
- Preserve `## 🔗 Notas Relacionadas`.
- Preserve images, embeds, comments, code blocks, and tables.
- This is intentionally noisy; it exists for comparison.

### `clean_v1`

Use title and path plus cleaned semantic note content.

Remove:

- YAML/frontmatter.
- Generated footer.
- The managed block under `## 🔗 Notas Relacionadas` until the next `##` heading or end of file.
- Obsidian embeds and images such as `![[...]]`.
- Markdown images such as `![alt](path)`.
- HTML comments used for provenance, such as `<!-- gemini-artifact ... -->`.
- Link syntax while preserving visible text:
  - `[[Target|Display]]` becomes `Display`.
  - `[[Target]]` becomes `Target`.
  - `[Display](url)` becomes `Display`.

Preserve:

- Fenced code blocks.
- Inline code.
- Markdown tables.
- Headings.
- Normal body prose.

Do not mutate notes. These transforms are only for text sent to the embedding model.

### `legacy_v0`

Keep the current behavior only for migrated records or tests that need to compare old data.

Do not use `legacy_v0` for new default indexing.

## Store Contract

Move from path-only storage to profile-aware storage.

Recommended `index.json` v2 shape:

```ts
export type VectorIndexV2 = {
  schema: "related-notes-obsidian.vector-index.v2";
  updatedAt: number;
  migratedFrom?: "related-notes-obsidian.vector-index.v1";
  profiles: Record<string, {
    profileId: EmbeddingProfileId;
    profileVersion: number;
    embeddingModel: string;
    updatedAt: number;
    records: Record<string, NoteVectorRecord>;
  }>;
};
```

Extend `NoteVectorRecord`:

```ts
export type NoteVectorRecord = {
  path: string;
  title: string;
  folder: string;
  preview: string;
  rawContentHash: string;
  representationHash: string;
  mtime: number;
  embeddingModel: string;
  embeddingProfile: EmbeddingProfileId;
  embeddingProfileVersion: number;
  vector: number[];
  updatedAt: number;
};
```

Compatibility:

- Keep reading existing records with `contentHash`.
- For new records, prefer `rawContentHash` and `representationHash`.
- If needed for old tests, expose `contentHash` as an alias for `representationHash`, but do not use it as the Workbench note hash.

Store API changes:

```ts
getNote(path: string, profileId: EmbeddingProfileId): Promise<NoteVectorRecord | null>;
upsertNote(record: NoteVectorRecord): Promise<void>;
deleteNote(path: string, profileId: EmbeddingProfileId): Promise<void>;
listIndexedPaths(profileId: EmbeddingProfileId): Promise<string[]>;
searchSimilar(vector: number[], options: {
  limit: number;
  excludePath?: string;
  profileId: EmbeddingProfileId;
}): Promise<Array<NoteVectorRecord & { score: number }>>;
clearProfile(profileId: EmbeddingProfileId): Promise<void>;
clearAllProfiles(): Promise<void>;
listStoredProfiles(): Promise<EmbeddingProfileId[]>;
```

Index staleness:

- A note is current for a profile only when `rawContentHash`, `representationHash`, `embeddingModel`, `embeddingProfile`, and `embeddingProfileVersion` all match.
- A path indexed for `raw_v1` does not count as indexed for `clean_v1`.
- Deleted notes should be cleaned only within the profile being scanned, unless the user explicitly clears all profiles.

## Indexing Behavior

Normal commands use `settings.defaultEmbeddingProfile`.

- `indexCurrentFile()` indexes the active file for the default profile.
- `indexMissingNotes()` indexes notes missing from the default profile only.
- `reindexVault()` scans all notes and refreshes stale or missing records for the default profile.
- After any default-profile indexing success, export the Workbench artifact.

Add profile-specific internal APIs:

```ts
indexCurrentFile(file, profileId)
indexMissingNotes(profileId)
reindexVault(profileId)
```

Settings buttons can call these APIs for selected profiles.

Recommended settings controls:

- Dropdown: `Default embedding profile`
  - options: `Clean v1`, `Raw v1`
  - default: `Clean v1`
- Multi-select or checkboxes: `Stored profiles`
  - `Clean v1`
  - `Raw v1`
  - `Legacy v0` only if migrated records exist
- Dropdown: `Sidebar mode`
  - `Default profile`
  - `Single stored profile`
  - `Compare two profiles`
- Dropdown: `Single profile`
- Dropdowns: `Compare left` and `Compare right`
- Button: `Index missing notes for default profile`
- Button: `Reindex default profile`
- Button: `Index all stored profiles`
- Warning button: `Clear default profile index`
- Strong warning button: `Clear all profile indexes`

When the default profile changes:

- Save settings.
- Refresh provider/indexer.
- Refresh sidebar.
- Show a notice if the new default profile has missing or stale notes.
- Do not delete the previous profile.

## Related Notes Service Behavior

`RelatedNotesService.getRelatedNotes()` must accept a profile id:

```ts
getRelatedNotes(path: string, limit: number, profileId: EmbeddingProfileId)
```

Behavior:

- Load the current note vector for the requested profile.
- Search only records from the same profile.
- Return `not_indexed` when the current note is missing for that profile, even if it exists in another profile.
- The sidebar should make the active profile visible in the UI so the user knows which graph they are inspecting.

## Sidebar Comparison Behavior

Keep the default list simple. Add compare mode without changing the normal behavior.

### Default mode

Shows related notes for `settings.defaultEmbeddingProfile`.

### Single profile mode

Shows related notes for `settings.sidebarSelectedProfile`.

### Compare mode

Shows two profile results for the same active note.

Minimum viable UI:

- Header displays the two profiles being compared.
- Section `Both profiles`:
  - notes present in both result sets;
  - show left score, right score, and score delta.
- Section `Only in Clean v1`.
- Section `Only in Raw v1`.
- Section `Rank changed`:
  - notes present in both but moved by at least 2 rank positions.

Comparison should be local UI only. It must not affect Workbench export.

If either selected profile is not indexed for the current note:

- Show an actionable state for that profile.
- Offer `Index current note for this profile`.
- Offer `Index missing notes for this profile`.

## Workbench Export Contract

Workbench export must continue to be stable and redacted.

Required behavior:

- Export only `settings.defaultEmbeddingProfile`.
- Do not export comparison profiles.
- Do not export vectors.
- Do not export previews.
- Do not export raw Markdown.
- Do not export API keys.
- Keep `notes[].content_hash` as the raw Markdown SHA-256 hash, not the representation hash.
- Edges are generated from default-profile related-note results.

Add profile metadata if the Workbench consumer accepts additive fields:

```ts
embedding_profile: {
  id: "clean_v1",
  version: 1,
  model: "gemini-...",
  representation_hash_basis: "profile_cleaned_markdown",
}
```

Before adding this field, inspect the Workbench consumer for strict JSON validation. The previously validated consumer path was:

```text
/Users/augustocaruso/Documents/medical-notes-workbench/extension/scripts/mednotes/wiki/related_notes.py
```

If the consumer rejects unknown fields, either:

- keep export schema v1 unchanged for this slice and add profile metadata to a sidecar `medical-notes-export-meta.json`; or
- coordinate a v2 schema change with the Workbench in the same implementation branch.

Do not break the current required v1 fields:

- `schema`
- `generated_at`
- `vault_root`
- `plugin`
- `score_scale`
- `notes`
- `edges`

## Tests To Add Or Update

### Representation tests

Create `tests/indexing/noteRepresentation.test.ts`.

Required cases:

- `clean_v1` removes YAML/frontmatter.
- `clean_v1` removes the managed `## 🔗 Notas Relacionadas` section.
- `clean_v1` removes image embeds and Markdown images.
- `clean_v1` removes provenance HTML comments.
- `clean_v1` preserves fenced code blocks.
- `clean_v1` preserves Markdown tables.
- `clean_v1` turns Wikilinks and Markdown links into visible text.
- `raw_v1` preserves YAML, footer, related notes, images, comments, code blocks, and tables.
- `raw_v1` and `clean_v1` produce different representation hashes for a note containing generated scaffolding.

### Store tests

Create or extend tests for `JsonVectorStore`.

Required cases:

- v1 `index.json` path-keyed data migrates to `legacy_v0`.
- `getNote(path, "clean_v1")` does not return a `raw_v1` record.
- `listIndexedPaths("clean_v1")` only returns clean records.
- `searchSimilar(..., { profileId: "clean_v1" })` only searches clean records.
- `clearProfile("clean_v1")` preserves `raw_v1`.
- `clearAllProfiles()` removes all profiles.

### Indexer tests

Extend `tests/indexing/VaultIndexer.test.ts`.

Required cases:

- `indexMissingNotes("clean_v1")` embeds only files missing from `clean_v1`, even if they exist in `raw_v1`.
- `reindexVault("clean_v1")` skips unchanged clean records.
- `reindexVault("clean_v1")` re-embeds when representation hash changes.
- `indexCurrentFile(file, "raw_v1")` writes a raw profile record without touching clean profile records.

### Related service tests

Add tests for profile-specific lookup:

- A note indexed in `raw_v1` but not `clean_v1` returns `not_indexed` for `clean_v1`.
- Similarity search only compares vectors from the selected profile.

### Sidebar helper tests

Prefer extracting comparison logic into a pure helper, for example `src/ui/profileComparison.ts`.

Required cases:

- computes `both`, `leftOnly`, `rightOnly`, and `rankChanged`.
- sorts `both` by best combined rank or highest score.
- computes score deltas.

### Workbench export tests

Extend `tests/export/WorkbenchExport.test.ts`.

Required cases:

- export uses only the default profile.
- export keeps raw Markdown `content_hash`.
- export does not contain vectors, previews, raw Markdown, API keys, or cache internals.
- export includes profile metadata only if compatible with the Workbench consumer.

## Implementation Tasks

### Task 1: Profile Types And Settings Defaults

**Files:**

- Modify: `src/types.ts`
- Modify: `src/main.ts`
- Modify: `src/settings.ts`
- Test: settings validation can be tested through pure helper if extracted.

- [ ] Add `EmbeddingProfileId`, profile definitions, and default settings.
- [ ] Normalize settings during `loadSettings()`.
- [ ] Ensure default profile is always present in stored profiles.
- [ ] Ensure invalid profile ids fall back to `clean_v1`.
- [ ] Commit with message:

```bash
git add src/types.ts src/main.ts src/settings.ts
git commit -m "feat: add embedding profile settings contract"
```

### Task 2: Representation Profiles

**Files:**

- Modify: `src/indexing/noteRepresentation.ts`
- Create: `tests/indexing/noteRepresentation.test.ts`

- [ ] Write failing tests for `clean_v1` and `raw_v1`.
- [ ] Refactor `buildNoteRepresentation()` to accept `profileId`.
- [ ] Implement `raw_v1`.
- [ ] Implement `clean_v1`.
- [ ] Preserve code blocks and tables in `clean_v1`.
- [ ] Keep legacy behavior available only as `legacy_v0` if needed for migration tests.
- [ ] Run:

```bash
npm run test -- tests/indexing/noteRepresentation.test.ts
```

- [ ] Commit with message:

```bash
git add src/indexing/noteRepresentation.ts tests/indexing/noteRepresentation.test.ts
git commit -m "feat: add clean and raw embedding representations"
```

### Task 3: Profile-Aware Store

**Files:**

- Modify: `src/store/NoteVectorStore.ts`
- Modify: `src/store/JsonVectorStore.ts`
- Modify: `src/types.ts`
- Create or extend: `tests/store/JsonVectorStore.test.ts`

- [ ] Add profile id to all store read/search/list/clear operations.
- [ ] Implement v2 `index.json` shape.
- [ ] Migrate old path-keyed `index.json` into `legacy_v0`.
- [ ] Keep old data readable but not used as default `clean_v1`.
- [ ] Add profile-specific clear and clear-all operations.
- [ ] Run store tests.
- [ ] Commit with message:

```bash
git add src/store/NoteVectorStore.ts src/store/JsonVectorStore.ts src/types.ts tests/store/JsonVectorStore.test.ts
git commit -m "feat: make vector store profile-aware"
```

### Task 4: Profile-Aware Indexing

**Files:**

- Modify: `src/indexing/VaultIndexer.ts`
- Modify: `src/main.ts`
- Modify: `tests/indexing/VaultIndexer.test.ts`

- [ ] Pass `defaultEmbeddingProfile` into normal indexing commands.
- [ ] Add internal profile-specific index methods.
- [ ] Use raw Markdown hash and representation hash separately.
- [ ] Treat missing/stale per profile, not per path globally.
- [ ] Keep `indexMissingNotes()` as the fast path for the active/default profile.
- [ ] Export Workbench artifact after successful default-profile indexing.
- [ ] Run indexer tests.
- [ ] Commit with message:

```bash
git add src/indexing/VaultIndexer.ts src/main.ts tests/indexing/VaultIndexer.test.ts
git commit -m "feat: index notes per embedding profile"
```

### Task 5: Profile-Aware Related Notes Service

**Files:**

- Modify: `src/related/RelatedNotesService.ts`
- Add tests if service tests do not exist.

- [ ] Add `profileId` argument to `getRelatedNotes()`.
- [ ] Load current vector from the requested profile.
- [ ] Search only within the requested profile.
- [ ] Return `not_indexed` per profile.
- [ ] Commit with message:

```bash
git add src/related/RelatedNotesService.ts tests/related/RelatedNotesService.test.ts
git commit -m "feat: scope related note lookup by profile"
```

### Task 6: Settings UI For Profile Management

**Files:**

- Modify: `src/settings.ts`
- Modify: `src/main.ts`

- [ ] Add default profile dropdown.
- [ ] Add stored profile controls.
- [ ] Add sidebar mode controls.
- [ ] Add compare profile controls.
- [ ] Add profile-aware indexing buttons.
- [ ] Change clear index behavior to distinguish default-profile clear from all-profile clear.
- [ ] Commit with message:

```bash
git add src/settings.ts src/main.ts
git commit -m "feat: add embedding profile controls"
```

### Task 7: Sidebar Profile And Compare Modes

**Files:**

- Modify: `src/ui/RelatedNotesView.ts`
- Modify: `src/ui/viewHelpers.ts` if needed.
- Create: `src/ui/profileComparison.ts`
- Create: `tests/ui/profileComparison.test.ts`
- Modify: `styles.css`

- [ ] Extract comparison helper.
- [ ] Add default/single/compare sidebar rendering.
- [ ] Show profile labels in the header.
- [ ] Show actionable not-indexed states per profile.
- [ ] Add minimal compare styling.
- [ ] Run UI helper tests.
- [ ] Commit with message:

```bash
git add src/ui/RelatedNotesView.ts src/ui/profileComparison.ts tests/ui/profileComparison.test.ts styles.css
git commit -m "feat: compare related notes across profiles"
```

### Task 8: Workbench Export Uses Default Profile

**Files:**

- Modify: `src/export/WorkbenchExport.ts`
- Modify: `src/types.ts`
- Modify: `tests/export/WorkbenchExport.test.ts`
- Optionally inspect: `/Users/augustocaruso/Documents/medical-notes-workbench/extension/scripts/mednotes/wiki/related_notes.py`

- [ ] Make `writeWorkbenchExport()` accept `profileId`.
- [ ] List and export only records for that profile.
- [ ] Generate edges using related-note service for that profile.
- [ ] Keep raw Markdown `content_hash`.
- [ ] Add profile metadata only if compatible with the Workbench consumer.
- [ ] Keep redaction guard strict.
- [ ] Commit with message:

```bash
git add src/export/WorkbenchExport.ts src/types.ts tests/export/WorkbenchExport.test.ts
git commit -m "feat: export active embedding profile for workbench"
```

### Task 9: Full Verification And Release Prep

**Files:**

- Modify: `README.md`
- Modify: `manifest.json` only if releasing a plugin version in the same branch.

- [ ] Document `clean_v1`, `raw_v1`, default profile, stored profiles, and Workbench export behavior.
- [ ] Run:

```bash
npm run build
npm run test
```

- [ ] Manually verify in Obsidian when possible:
  - default profile setting persists;
  - `clean_v1` indexing works;
  - `raw_v1` indexing works;
  - sidebar default mode works;
  - sidebar compare mode works;
  - Workbench export writes the active default profile only.
- [ ] Commit with message:

```bash
git add README.md manifest.json package.json package-lock.json
git commit -m "docs: document embedding profiles"
```

## Acceptance Criteria

- Settings expose profile management clearly.
- `clean_v1` is the default for new installs and after settings normalization.
- Normal indexing commands target the default profile.
- Raw and clean embeddings can coexist in local storage.
- Sidebar can inspect one stored profile or compare two stored profiles.
- Workbench export contains only the default profile graph.
- Workbench export remains redacted and stable.
- Existing old index data is preserved but not mislabeled.
- Code blocks and tables are preserved in `clean_v1`.
- YAML/frontmatter, footer, managed Related Notes section, embeds/images, and provenance comments are removed from `clean_v1`.
- `npm run build` passes.
- `npm run test` passes.

## Non-Goals For This Slice

- Do not change the Gemini embedding model.
- Do not add LLM reranking.
- Do not change Workbench link application logic.
- Do not export vectors or previews.
- Do not delete raw or legacy profile data automatically.
- Do not make the plugin decide the Workbench threshold policy.

## Open Implementation Choice

The only meaningful implementation choice left is whether profile indexes live in one `index.json` v2 or in separate files such as `index.clean_v1.json` and `index.raw_v1.json`.

Recommendation: use one `index.json` v2 with top-level `profiles`.

Reason:

- keeps migration centralized;
- keeps backup/export behavior simple;
- avoids multiple adapter reads for normal startup;
- makes all-profile clear and profile stats easier.

If the file becomes too large or slow, split by profile later without changing the public settings contract.
