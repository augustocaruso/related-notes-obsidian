export type NoteVectorRecord = {
  path: string;
  title: string;
  folder: string;
  preview: string;
  contentHash: string;
  mtime: number;
  embeddingModel: string;
  vector: number[];
  updatedAt: number;
};

export interface RelatedNotesSettings {
  geminiApiKey: string;
  relatedNotesLimit: number;
  embeddingRequestDelayMs: number;
}

export const DEFAULT_SETTINGS: RelatedNotesSettings = {
  geminiApiKey: "",
  relatedNotesLimit: 10,
  embeddingRequestDelayMs: 0,
};

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
