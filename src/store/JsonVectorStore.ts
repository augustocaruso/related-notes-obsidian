import {
  EMBEDDING_PROFILES,
  type EmbeddingProfileId,
  type NoteVectorRecord,
  type VectorIndexV2,
  type VectorProfileBucket,
  isEmbeddingProfileId,
} from "../types";
import { NoteVectorStore } from "./NoteVectorStore";
import type { Plugin } from "obsidian";

export class JsonVectorStore implements NoteVectorStore {
  private index: VectorIndexV2 = createEmptyIndex();
  private storagePath: string;

  constructor(private plugin: Plugin) {
    // Correct way to get the plugin data folder: this.plugin.manifest.id or hardcoded safe path
    this.storagePath = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/index.json`;
  }

  async init(): Promise<void> {
    console.log("Initializing JsonVectorStore with path:", this.storagePath);
    if (await this.plugin.app.vault.adapter.exists(this.storagePath)) {
      const content = await this.plugin.app.vault.adapter.read(this.storagePath);
      console.log("Found index.json, size:", content.length);
      try {
        const parsed = JSON.parse(content);
        this.index = parseVectorIndex(parsed);
        console.log("Loaded profiles:", Object.keys(this.index.profiles).length);
      } catch (e) {
        console.error("Failed to parse vector index:", e);
      }
    } else {
        console.log("No index.json found at storagePath.");
    }
  }

  private async save(): Promise<void> {
    this.index.updatedAt = Date.now();
    await this.plugin.app.vault.adapter.write(this.storagePath, JSON.stringify(this.index, null, 2));
  }

  async upsertNote(record: NoteVectorRecord): Promise<void> {
    const bucket = this.getOrCreateBucket(record.embeddingProfile, record.embeddingModel);
    bucket.records[record.path] = normalizeRecord(record, record.embeddingProfile);
    bucket.profileVersion = record.embeddingProfileVersion;
    bucket.embeddingModel = record.embeddingModel;
    bucket.updatedAt = Date.now();
    // Don't auto-save for single updates to avoid I/O bottlenecks
  }

  async upsertNotes(records: NoteVectorRecord[]): Promise<void> {
    for (const record of records) {
      await this.upsertNote(record);
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    await this.save();
  }

  async getNote(path: string, profileId: EmbeddingProfileId): Promise<NoteVectorRecord | null> {
    const records = this.index.profiles[profileId]?.records ?? {};
    const note = records[path];
    if (!note) {
        console.log("[JsonVectorStore] Note not found for path:", path);
        // Try normalized path (Obsidian sometimes sends paths with/without leading slash or different separators)
        const normalized = path.replace(/\\/g, "/");
        return records[normalized] || null;
    }
    return note;
  }

  async deleteNote(path: string, profileId: EmbeddingProfileId): Promise<void> {
    const bucket = this.index.profiles[profileId];
    if (bucket) {
      delete bucket.records[path];
      bucket.updatedAt = Date.now();
    }
    await this.save();
  }

  async listIndexedPaths(profileId: EmbeddingProfileId): Promise<string[]> {
    return Object.keys(this.index.profiles[profileId]?.records ?? {}).sort();
  }

  async clearProfile(profileId: EmbeddingProfileId): Promise<void> {
    delete this.index.profiles[profileId];
    await this.save();
  }

  async clearAllProfiles(): Promise<void> {
    this.index = createEmptyIndex();
    await this.save();
  }

  async listStoredProfiles(): Promise<EmbeddingProfileId[]> {
    return (Object.keys(this.index.profiles) as EmbeddingProfileId[])
      .filter((profileId) => isEmbeddingProfileId(profileId))
      .filter((profileId) => Object.keys(this.index.profiles[profileId]?.records ?? {}).length > 0)
      .sort((a, b) => profileSortIndex(a) - profileSortIndex(b));
  }

  async clear(): Promise<void> {
    await this.clearAllProfiles();
  }

  async searchSimilar(
    vector: number[],
    options: { limit: number; excludePath?: string; profileId: EmbeddingProfileId }
  ): Promise<Array<NoteVectorRecord & { score: number }>> {
    const results: Array<NoteVectorRecord & { score: number }> = [];

    const records = Object.values(this.index.profiles[options.profileId]?.records ?? {});
    for (const record of records) {
      if (options.excludePath && record.path === options.excludePath) continue;

      const score = this.cosineSimilarity(vector, record.vector);
      results.push({ ...record, score });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private getOrCreateBucket(profileId: EmbeddingProfileId, embeddingModel: string): VectorProfileBucket {
    const existing = this.index.profiles[profileId];
    if (existing) return existing;
    const profile = EMBEDDING_PROFILES[profileId];
    const bucket: VectorProfileBucket = {
      profileId,
      profileVersion: profile.version,
      embeddingModel,
      updatedAt: Date.now(),
      records: {},
    };
    this.index.profiles[profileId] = bucket;
    return bucket;
  }
}

function createEmptyIndex(): VectorIndexV2 {
  return {
    schema: "related-notes-obsidian.vector-index.v2",
    updatedAt: Date.now(),
    profiles: {},
  };
}

function parseVectorIndex(value: unknown): VectorIndexV2 {
  if (isVectorIndexV2(value)) return normalizeVectorIndexV2(value);
  return migratePathKeyedIndex(value);
}

function isVectorIndexV2(value: unknown): value is VectorIndexV2 {
  return Boolean(
    value
      && typeof value === "object"
      && (value as { schema?: unknown }).schema === "related-notes-obsidian.vector-index.v2"
      && typeof (value as { profiles?: unknown }).profiles === "object",
  );
}

function normalizeVectorIndexV2(value: VectorIndexV2): VectorIndexV2 {
  const index: VectorIndexV2 = {
    schema: "related-notes-obsidian.vector-index.v2",
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
    migratedFrom: value.migratedFrom,
    profiles: {},
  };

  for (const [profileId, bucket] of Object.entries(value.profiles)) {
    if (!isEmbeddingProfileId(profileId) || !bucket) continue;
    index.profiles[profileId] = {
      profileId,
      profileVersion: bucket.profileVersion ?? EMBEDDING_PROFILES[profileId].version,
      embeddingModel: bucket.embeddingModel ?? "",
      updatedAt: bucket.updatedAt ?? Date.now(),
      records: Object.fromEntries(
        Object.entries(bucket.records ?? {}).map(([path, record]) => [
          path,
          normalizeRecord(record, profileId),
        ]),
      ),
    };
  }

  return index;
}

function migratePathKeyedIndex(value: unknown): VectorIndexV2 {
  const index = createEmptyIndex();
  if (!value || typeof value !== "object" || Array.isArray(value)) return index;

  const records: Record<string, NoteVectorRecord> = {};
  for (const [path, rawRecord] of Object.entries(value as Record<string, unknown>)) {
    if (!rawRecord || typeof rawRecord !== "object") continue;
    const record = normalizeRecord({ ...(rawRecord as Record<string, unknown>), path }, "legacy_v0");
    records[path] = record;
  }

  if (Object.keys(records).length > 0) {
    index.migratedFrom = "related-notes-obsidian.vector-index.v1";
    index.profiles.legacy_v0 = {
      profileId: "legacy_v0",
      profileVersion: EMBEDDING_PROFILES.legacy_v0.version,
      embeddingModel: firstRecord(records)?.embeddingModel ?? "",
      updatedAt: Date.now(),
      records,
    };
  }

  return index;
}

function normalizeRecord(rawRecord: unknown, profileId: EmbeddingProfileId): NoteVectorRecord {
  const record = (rawRecord && typeof rawRecord === "object" ? rawRecord : {}) as Partial<NoteVectorRecord>;
  const representationHash = record.representationHash ?? record.contentHash ?? "";
  return {
    path: String(record.path ?? ""),
    title: String(record.title ?? record.path ?? ""),
    folder: String(record.folder ?? ""),
    preview: String(record.preview ?? ""),
    rawContentHash: String(record.rawContentHash ?? record.contentHash ?? representationHash),
    representationHash: String(representationHash),
    contentHash: String(record.contentHash ?? representationHash),
    mtime: typeof record.mtime === "number" ? record.mtime : 0,
    embeddingModel: String(record.embeddingModel ?? ""),
    embeddingProfile: profileId,
    embeddingProfileVersion: typeof record.embeddingProfileVersion === "number"
      ? record.embeddingProfileVersion
      : EMBEDDING_PROFILES[profileId].version,
    vector: Array.isArray(record.vector) ? record.vector.filter((item) => typeof item === "number") : [],
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
  };
}

function firstRecord(records: Record<string, NoteVectorRecord>): NoteVectorRecord | undefined {
  return Object.values(records)[0];
}

function profileSortIndex(profileId: EmbeddingProfileId): number {
  const order: EmbeddingProfileId[] = ["clean_v1", "raw_v1", "legacy_v0"];
  return order.indexOf(profileId);
}
