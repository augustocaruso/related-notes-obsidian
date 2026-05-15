import type {
  EmbeddingProfileId,
  WorkbenchRelatedEdge,
  WorkbenchRelatedNote,
  WorkbenchRelatedNotesExport,
} from "../types";
import { DEFAULT_EMBEDDING_PROFILE, EMBEDDING_PROFILES } from "../types";
import { sha256 } from "../indexing/hash";
import type { RelatedNotesService } from "../related/RelatedNotesService";
import type { NoteVectorStore } from "../store/NoteVectorStore";
import type { App, Plugin, TFile } from "obsidian";

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
  profileId: EmbeddingProfileId;
  embeddingModel: string;
  notes: ExportNoteInput[];
  relatedBySource: Map<string, RelatedInput[]>;
};

export const WORKBENCH_EXPORT_PATH = "medical-notes-export.json";

export type WriteWorkbenchExportOptions = {
  app: App;
  plugin: Plugin;
  store: NoteVectorStore;
  service: RelatedNotesService;
  limit: number;
  profileId?: EmbeddingProfileId;
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
  "embeddings",
]);

export function buildWorkbenchExportPayload(
  input: BuildWorkbenchExportPayloadInput,
): WorkbenchRelatedNotesExport {
  const notes: WorkbenchRelatedNote[] = [...input.notes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((note) => ({
      path: note.path,
      title: note.title,
      content_hash: normalizeSha256(note.contentHash),
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
        source: "related-notes-obsidian",
      });
    });
  }

  const payload: WorkbenchRelatedNotesExport = {
    schema: "medical-notes-workbench.related-notes-export.v1",
    generated_at: input.generatedAt,
    vault_root: input.vaultRoot,
    plugin: {
      name: input.pluginName,
      version: input.pluginVersion,
    },
    model: {
      embedding_model: input.embeddingModel,
      embedding_profile_id: input.profileId,
      embedding_profile_version: EMBEDDING_PROFILES[input.profileId].version,
      representation_hash_basis: representationHashBasis(input.profileId),
    },
    score_scale: "0_to_1",
    notes,
    edges,
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

export async function writeWorkbenchExport(options: WriteWorkbenchExportOptions): Promise<{
  path: string;
  noteCount: number;
  edgeCount: number;
}> {
  const profileId = options.profileId ?? DEFAULT_EMBEDDING_PROFILE;
  const indexedPaths = await options.store.listIndexedPaths(profileId);
  const notes: ExportNoteInput[] = [];
  const relatedBySource = new Map<string, RelatedInput[]>();
  let embeddingModel = "";

  for (const path of [...indexedPaths].sort()) {
    const file = options.app.vault.getAbstractFileByPath(path);
    if (!isMarkdownFile(file)) continue;

    const record = await options.store.getNote(file.path, profileId);
    if (!record) continue;
    if (!embeddingModel) embeddingModel = record.embeddingModel;

    const markdown = await options.app.vault.read(file);
    notes.push({
      path: file.path,
      title: file.basename,
      contentHash: `sha256:${sha256(markdown)}`,
    });

    const result = await options.service.getRelatedNotes(file.path, options.limit, profileId);
    relatedBySource.set(
      file.path,
      result.status === "ok"
        ? result.notes.map((note) => ({
            path: note.path,
            title: note.title,
            score: note.score,
          }))
        : [],
    );
  }

  const payload = buildWorkbenchExportPayload({
    generatedAt: new Date().toISOString(),
    vaultRoot: getVaultRoot(options.app),
    pluginName: options.plugin.manifest.id,
    pluginVersion: options.plugin.manifest.version,
    profileId,
    embeddingModel,
    notes,
    relatedBySource,
  });
  const path = `${options.app.vault.configDir}/plugins/${options.plugin.manifest.id}/${WORKBENCH_EXPORT_PATH}`;
  await options.app.vault.adapter.write(path, JSON.stringify(payload, null, 2));
  return { path, noteCount: payload.notes.length, edgeCount: payload.edges.length };
}

function representationHashBasis(
  profileId: EmbeddingProfileId,
): "profile_cleaned_markdown" | "raw_markdown" | "legacy_hybrid_markdown" {
  if (profileId === "raw_v1") return "raw_markdown";
  if (profileId === "legacy_v0") return "legacy_hybrid_markdown";
  return "profile_cleaned_markdown";
}

function normalizeSha256(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("sha256:") ? trimmed : `sha256:${trimmed}`;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isMarkdownFile(file: unknown): file is TFile {
  const maybeFile = file as Partial<TFile> | null | undefined;
  return Boolean(
    maybeFile
      && typeof maybeFile.path === "string"
      && typeof maybeFile.basename === "string"
      && maybeFile.extension === "md",
  );
}

function getVaultRoot(app: App): string {
  const adapter = app.vault.adapter as unknown as { getBasePath?: () => string; basePath?: string };
  if (typeof adapter.getBasePath === "function") return adapter.getBasePath();
  if (typeof adapter.basePath === "string") return adapter.basePath;
  return "";
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
