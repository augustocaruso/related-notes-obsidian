export type EmbeddingProfileId = "clean_v1" | "raw_v1" | "legacy_v0";

export type SidebarProfileMode = "default" | "single" | "compare";

export type EmbeddingProfileDefinition = {
  id: EmbeddingProfileId;
  version: 1;
  label: string;
  description: string;
  includeTitle: boolean;
  includePath: boolean;
  transform: EmbeddingProfileId;
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

export const DEFAULT_EMBEDDING_PROFILE: EmbeddingProfileId = "clean_v1";

export const USER_SELECTABLE_EMBEDDING_PROFILES: EmbeddingProfileId[] = ["clean_v1", "raw_v1"];

export type NoteVectorRecord = {
  path: string;
  title: string;
  folder: string;
  preview: string;
  rawContentHash: string;
  representationHash: string;
  contentHash?: string;
  mtime: number;
  embeddingModel: string;
  embeddingProfile: EmbeddingProfileId;
  embeddingProfileVersion: number;
  vector: number[];
  updatedAt: number;
};

export interface RelatedNotesSettings {
  geminiApiKey: string;
  relatedNotesLimit: number;
  embeddingRequestDelayMs: number;
  defaultEmbeddingProfile: EmbeddingProfileId;
  storedEmbeddingProfiles: EmbeddingProfileId[];
  sidebarProfileMode: SidebarProfileMode;
  sidebarSelectedProfile: EmbeddingProfileId;
  sidebarCompareLeftProfile: EmbeddingProfileId;
  sidebarCompareRightProfile: EmbeddingProfileId;
}

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

export type VectorProfileBucket = {
  profileId: EmbeddingProfileId;
  profileVersion: number;
  embeddingModel: string;
  updatedAt: number;
  records: Record<string, NoteVectorRecord>;
};

export type VectorIndexV2 = {
  schema: "related-notes-obsidian.vector-index.v2";
  updatedAt: number;
  migratedFrom?: "related-notes-obsidian.vector-index.v1";
  profiles: Partial<Record<EmbeddingProfileId, VectorProfileBucket>>;
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
  model?: {
    embedding_model: string;
    embedding_profile_id: EmbeddingProfileId;
    embedding_profile_version: number;
    representation_hash_basis: "profile_cleaned_markdown" | "raw_markdown" | "legacy_hybrid_markdown";
  };
  score_scale: "0_to_1";
  notes: WorkbenchRelatedNote[];
  edges: WorkbenchRelatedEdge[];
};

export function isEmbeddingProfileId(value: unknown): value is EmbeddingProfileId {
  return typeof value === "string" && value in EMBEDDING_PROFILES;
}

export function isUserSelectableEmbeddingProfileId(value: unknown): value is EmbeddingProfileId {
  return USER_SELECTABLE_EMBEDDING_PROFILES.includes(value as EmbeddingProfileId);
}

export function getEmbeddingProfileLabel(profileId: EmbeddingProfileId): string {
  return EMBEDDING_PROFILES[profileId].label;
}

export function normalizeRelatedNotesSettings(input: unknown): RelatedNotesSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<RelatedNotesSettings>;
  const defaultEmbeddingProfile = isUserSelectableEmbeddingProfileId(raw.defaultEmbeddingProfile)
    ? raw.defaultEmbeddingProfile
    : DEFAULT_EMBEDDING_PROFILE;

  const rawStored = Array.isArray(raw.storedEmbeddingProfiles)
    ? raw.storedEmbeddingProfiles
    : DEFAULT_SETTINGS.storedEmbeddingProfiles;
  const storedEmbeddingProfiles = dedupeProfiles(
    rawStored.filter(isUserSelectableEmbeddingProfileId).concat(defaultEmbeddingProfile),
  );

  const sidebarProfileMode: SidebarProfileMode = raw.sidebarProfileMode === "single" || raw.sidebarProfileMode === "compare"
    ? raw.sidebarProfileMode
    : "default";
  const sidebarSelectedProfile = chooseStoredProfile(raw.sidebarSelectedProfile, storedEmbeddingProfiles, defaultEmbeddingProfile);
  const sidebarCompareLeftProfile = chooseStoredProfile(
    raw.sidebarCompareLeftProfile,
    storedEmbeddingProfiles,
    defaultEmbeddingProfile,
  );
  const sidebarCompareRightProfile = chooseStoredProfile(
    raw.sidebarCompareRightProfile,
    storedEmbeddingProfiles,
    storedEmbeddingProfiles.find((profile) => profile !== sidebarCompareLeftProfile) ?? defaultEmbeddingProfile,
  );

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    relatedNotesLimit: normalizeLimit(raw.relatedNotesLimit),
    embeddingRequestDelayMs: normalizeDelayMs(raw.embeddingRequestDelayMs),
    defaultEmbeddingProfile,
    storedEmbeddingProfiles,
    sidebarProfileMode,
    sidebarSelectedProfile,
    sidebarCompareLeftProfile,
    sidebarCompareRightProfile,
  };
}

function dedupeProfiles(profiles: EmbeddingProfileId[]): EmbeddingProfileId[] {
  return [...new Set(profiles)];
}

function chooseStoredProfile(
  value: unknown,
  storedProfiles: EmbeddingProfileId[],
  fallback: EmbeddingProfileId,
): EmbeddingProfileId {
  return isEmbeddingProfileId(value) && storedProfiles.includes(value) ? value : fallback;
}

function normalizeLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(50, Math.floor(value)))
    : DEFAULT_SETTINGS.relatedNotesLimit;
}

function normalizeDelayMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : DEFAULT_SETTINGS.embeddingRequestDelayMs;
}
