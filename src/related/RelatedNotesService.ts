import { NoteVectorStore } from "../store/NoteVectorStore";
import { DEFAULT_EMBEDDING_PROFILE, EmbeddingProfileId, NoteVectorRecord } from "../types";

export class RelatedNotesService {
  constructor(private store: NoteVectorStore) {}

  async getRelatedNotes(path: string, limit = 10, profileId: EmbeddingProfileId = DEFAULT_EMBEDDING_PROFILE): Promise<{
    status: "ok" | "not_indexed" | "error";
    notes: Array<NoteVectorRecord & { score: number }>;
  }> {
    try {
      const current = await this.store.getNote(path, profileId);

      if (!current) {
        return {
          status: "not_indexed",
          notes: [],
        };
      }

      const results = await this.store.searchSimilar(current.vector, {
        limit: limit,
        excludePath: path,
        profileId,
      });

      return {
        status: "ok",
        notes: results,
      };
    } catch (e) {
      console.error("RelatedNotesService Error:", e);
      return {
        status: "error",
        notes: [],
      };
    }
  }
}
