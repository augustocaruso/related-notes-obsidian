# Related Notes (Gemini)

Obsidian plugin that finds semantically related notes using Gemini embeddings.

## Features

- Indexes Markdown notes in an Obsidian vault.
- Generates embeddings with the Gemini API.
- Shows semantically related notes inside Obsidian.
- Supports clean and raw embedding profiles for local comparison.
- Stores the local vector index in the plugin data folder.

## Development

```bash
npm install
npm run build
```

## Indexing Modes

Use `Related Notes: Index missing notes only` when you only want to embed Markdown notes that are not already present in the local `index.json`. This is the fast path for adding new notes without scanning and hashing every note in the vault.

Use `Related Notes: Reindex vault` when you want a full refresh. It scans all Markdown notes and only calls Gemini for notes whose semantic representation changed, but the scan itself still touches every note.

The `Gemini request delay` setting controls the optional pause between embedding requests. It defaults to `0 ms`; increase it only if Gemini starts returning rate-limit errors.

## Embedding Profiles

`Clean v1` is the default profile. It removes generated note scaffolding before embedding, including frontmatter, managed Related Notes blocks, provenance comments, images, embeds, and generated footers. It keeps semantic Markdown structure such as headings, tables, inline code, and fenced code blocks.

`Raw v1` embeds the raw Markdown for explicit comparison. It preserves frontmatter, images, embeds, comments, footers, code blocks, tables, and the managed Related Notes section. It is not indexed by normal commands unless you make it the default or run the stored-profile indexing action.

Old path-keyed `index.json` data is migrated to `Legacy v0`. This preserves prior vectors for safety, but it is not treated as `Clean v1` or `Raw v1` and is hidden from normal profile controls.

## Medical Notes Workbench Export

After successful default-profile indexing, the plugin automatically writes:

```text
.obsidian/plugins/related-notes-obsidian/medical-notes-export.json
```

This file is the stable redacted artifact consumed by Medical Notes Workbench. It contains only the active default profile graph, note paths, titles, raw Markdown SHA-256 hashes, profile metadata, related-note scores, and ranks. It does not contain vectors, previews, API keys, raw Markdown, note bodies, or plugin cache internals.

You can force regeneration from the Obsidian command palette:

```text
Related Notes: Export Medical Notes Workbench related notes
```

## Privacy

Do not commit `data.json`, `index.json`, or vault-derived exports. They may contain API keys, note metadata, or generated embeddings from a private vault.

## License

MIT
