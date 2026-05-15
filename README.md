# Related Notes (Gemini)

Obsidian plugin that finds semantically related notes using Gemini embeddings.

## Features

- Indexes Markdown notes in an Obsidian vault.
- Generates embeddings with the Gemini API.
- Shows semantically related notes inside Obsidian.
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

## Privacy

Do not commit `data.json`, `index.json`, or vault-derived exports. They may contain API keys, note metadata, or generated embeddings from a private vault.

## License

MIT
