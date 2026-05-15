import { App, TFile } from "obsidian";
import { NoteVectorStore } from "../store/NoteVectorStore";
import { EmbeddingProvider } from "../embeddings/EmbeddingProvider";
import { GeminiEmbeddingProvider } from "../embeddings/GeminiEmbeddingProvider";
import { buildNoteRepresentation, makePreview } from "./noteRepresentation";
import { sha256 } from "./hash";
import { DEFAULT_EMBEDDING_PROFILE, EmbeddingProfileId, NoteVectorRecord } from "../types";

type ProgressCallback = (current: number, total: number) => void;

export class VaultIndexer {
  private embeddingRequestDelayMs: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(
    private app: App,
    private store: NoteVectorStore,
    private embeddingProvider: EmbeddingProvider,
    options: {
      embeddingRequestDelayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {}
  ) {
    this.embeddingRequestDelayMs = normalizeDelayMs(options.embeddingRequestDelayMs ?? 0);
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  setEmbeddingRequestDelayMs(delayMs: number) {
    this.embeddingRequestDelayMs = normalizeDelayMs(delayMs);
  }

  async reindexVault(
    profileId: EmbeddingProfileId = DEFAULT_EMBEDDING_PROFILE,
    onProgress?: ProgressCallback,
  ) {
    this.requireReadyProvider();

    const markdownFiles = this.app.vault.getMarkdownFiles();
    const total = markdownFiles.length;
    let current = 0;
    let processedInThisBatch = 0;

    const indexedPaths = new Set(await this.store.listIndexedPaths(profileId));

    try {
        for (const file of markdownFiles) {
          current++;
          if (onProgress) onProgress(current, total);

          try {
            const markdown = await this.app.vault.read(file);
            const built = buildNoteRepresentation({
              path: file.path,
              title: file.basename,
              markdown,
              profileId,
            });

            const rawContentHash = sha256(markdown);
            const existing = await this.store.getNote(file.path, profileId);

            if (existing && this.isRecordCurrent(existing, rawContentHash, built.representationHash, profileId, built.profileVersion)) {
              indexedPaths.delete(file.path);
              continue;
            }

            const vector = await this.embeddingProvider.embed(built.text);

            await this.store.upsertNote(this.makeRecord(file, rawContentHash, built, vector));

            indexedPaths.delete(file.path);
            processedInThisBatch++;

            // Periodic flush every 10 new embeddings as a safety measure
            if (processedInThisBatch % 10 === 0) {
                await this.store.flush();
            }

            await this.delayAfterEmbeddingRequest();
          } catch (e: any) {
            console.error(`Failed to index ${file.path}:`, e);
            
            // On 429 or quota errors, we MUST save and stop to prevent data loss
            if (e.message?.includes("429") || e.message?.includes("quota") || e.message?.includes("API key is missing")) {
                console.log("[VaultIndexer] Quota or Rate Limit hit. Flushing store...");
                await this.store.flush();
                throw e; 
            }
          }
        }

        // Cleanup deleted notes only if we completed the whole vault scan
        for (const orphanPath of indexedPaths) {
          await this.store.deleteNote(orphanPath, profileId);
        }
    } finally {
        await this.store.flush();
    }
  }

  async indexMissingNotes(
    profileId: EmbeddingProfileId = DEFAULT_EMBEDDING_PROFILE,
    onProgress?: ProgressCallback,
  ): Promise<{
    totalCount: number;
    indexedCount: number;
    skippedCount: number;
  }> {
    this.requireReadyProvider();

    const markdownFiles = this.app.vault.getMarkdownFiles();
    const indexedPaths = new Set(await this.store.listIndexedPaths(profileId));
    const missingFiles = markdownFiles.filter((file) => !indexedPaths.has(file.path));
    let current = 0;

    try {
      for (const file of missingFiles) {
        current++;
        if (onProgress) onProgress(current, missingFiles.length);

        await this.indexFile(file, profileId);

        if (current < missingFiles.length) {
          await this.delayAfterEmbeddingRequest();
        }
      }
    } finally {
      await this.store.flush();
    }

    return {
      totalCount: markdownFiles.length,
      indexedCount: missingFiles.length,
      skippedCount: markdownFiles.length - missingFiles.length,
    };
  }

  async indexFile(file: TFile, profileId: EmbeddingProfileId = DEFAULT_EMBEDDING_PROFILE) {
      try {
          const markdown = await this.app.vault.read(file);
          const built = buildNoteRepresentation({
              path: file.path,
              title: file.basename,
              markdown,
              profileId,
          });

          const rawContentHash = sha256(markdown);
          const vector = await this.embeddingProvider.embed(built.text);

          await this.store.upsertNote(this.makeRecord(file, rawContentHash, built, vector));
      } catch (e) {
          console.error(`Failed to index single file ${file.path}:`, e);
          throw e;
      }
  }

  private requireReadyProvider() {
    if (!this.embeddingProvider.model || !(this.embeddingProvider as GeminiEmbeddingProvider).apiKey) {
        throw new Error("Gemini API key is missing. Please add it in settings.");
    }
  }

  private async delayAfterEmbeddingRequest() {
    if (this.embeddingRequestDelayMs > 0) {
      await this.sleep(this.embeddingRequestDelayMs);
    }
  }

  private isRecordCurrent(
    record: NoteVectorRecord,
    rawContentHash: string,
    representationHash: string,
    profileId: EmbeddingProfileId,
    profileVersion: number,
  ): boolean {
    return record.rawContentHash === rawContentHash
      && record.representationHash === representationHash
      && record.embeddingModel === this.embeddingProvider.model
      && record.embeddingProfile === profileId
      && record.embeddingProfileVersion === profileVersion;
  }

  private makeRecord(
    file: TFile,
    rawContentHash: string,
    built: {
      text: string;
      representationHash: string;
      profileId: EmbeddingProfileId;
      profileVersion: number;
    },
    vector: number[],
  ): NoteVectorRecord {
    return {
      path: file.path,
      title: file.basename,
      folder: file.parent?.path ?? "",
      preview: makePreview(built.text),
      rawContentHash,
      representationHash: built.representationHash,
      contentHash: built.representationHash,
      mtime: file.stat.mtime,
      embeddingModel: this.embeddingProvider.model,
      embeddingProfile: built.profileId,
      embeddingProfileVersion: built.profileVersion,
      vector,
      updatedAt: Date.now(),
    };
  }
}

function normalizeDelayMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
