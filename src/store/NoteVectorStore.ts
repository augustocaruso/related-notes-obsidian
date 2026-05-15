import { EmbeddingProfileId, NoteVectorRecord } from "../types";

export interface NoteVectorStore {
  init(): Promise<void>;
  upsertNote(record: NoteVectorRecord): Promise<void>;
  upsertNotes(records: NoteVectorRecord[]): Promise<void>;
  getNote(path: string, profileId: EmbeddingProfileId): Promise<NoteVectorRecord | null>;
  deleteNote(path: string, profileId: EmbeddingProfileId): Promise<void>;
  searchSimilar(
    vector: number[],
    options: {
      limit: number;
      excludePath?: string;
      profileId: EmbeddingProfileId;
    }
  ): Promise<Array<NoteVectorRecord & { score: number }>>;
  listIndexedPaths(profileId: EmbeddingProfileId): Promise<string[]>;
  clearProfile(profileId: EmbeddingProfileId): Promise<void>;
  clearAllProfiles(): Promise<void>;
  listStoredProfiles(): Promise<EmbeddingProfileId[]>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}
