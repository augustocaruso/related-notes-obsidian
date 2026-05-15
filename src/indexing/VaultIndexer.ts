import { App, TFile } from "obsidian";
import { NoteVectorStore } from "../store/NoteVectorStore";
import { EmbeddingProvider } from "../embeddings/EmbeddingProvider";
import { GeminiEmbeddingProvider } from "../embeddings/GeminiEmbeddingProvider";
import { buildNoteRepresentation, makePreview } from "./noteRepresentation";
import { sha256 } from "./hash";

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

  async reindexVault(onProgress?: (current: number, total: number) => void) {
    this.requireReadyProvider();

    const markdownFiles = this.app.vault.getMarkdownFiles();
    const total = markdownFiles.length;
    let current = 0;
    let processedInThisBatch = 0;

    const indexedPaths = new Set(await this.store.listIndexedPaths());

    try {
        for (const file of markdownFiles) {
          current++;
          if (onProgress) onProgress(current, total);

          try {
            const markdown = await this.app.vault.read(file);
            const representation = buildNoteRepresentation({
              path: file.path,
              title: file.basename,
              markdown,
            });

            const contentHash = sha256(representation);
            const existing = await this.store.getNote(file.path);

            if (existing && existing.contentHash === contentHash) {
              indexedPaths.delete(file.path);
              continue;
            }

            const vector = await this.embeddingProvider.embed(representation);

            await this.store.upsertNote({
              path: file.path,
              title: file.basename,
              folder: file.parent?.path ?? "",
              preview: makePreview(representation),
              contentHash,
              mtime: file.stat.mtime,
              embeddingModel: this.embeddingProvider.model,
              vector,
              updatedAt: Date.now(),
            });

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
          await this.store.deleteNote(orphanPath);
        }
    } finally {
        await this.store.flush();
    }
  }

  async indexMissingNotes(onProgress?: (current: number, total: number) => void): Promise<{
    totalCount: number;
    indexedCount: number;
    skippedCount: number;
  }> {
    this.requireReadyProvider();

    const markdownFiles = this.app.vault.getMarkdownFiles();
    const indexedPaths = new Set(await this.store.listIndexedPaths());
    const missingFiles = markdownFiles.filter((file) => !indexedPaths.has(file.path));
    let current = 0;

    try {
      for (const file of missingFiles) {
        current++;
        if (onProgress) onProgress(current, missingFiles.length);

        await this.indexFile(file);

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

  async indexFile(file: TFile) {
      try {
          const markdown = await this.app.vault.read(file);
          const representation = buildNoteRepresentation({
              path: file.path,
              title: file.basename,
              markdown,
          });

          const contentHash = sha256(representation);
          const vector = await this.embeddingProvider.embed(representation);

          await this.store.upsertNote({
              path: file.path,
              title: file.basename,
              folder: file.parent?.path ?? "",
              preview: makePreview(representation),
              contentHash,
              mtime: file.stat.mtime,
              embeddingModel: this.embeddingProvider.model,
              vector,
              updatedAt: Date.now(),
          });
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
}

function normalizeDelayMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
