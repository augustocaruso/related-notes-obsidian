import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  normalizeRelatedNotesSettings,
} from "../src/types";

test("normalizeRelatedNotesSettings defaults to clean profile and keeps raw available", () => {
  const settings = normalizeRelatedNotesSettings({});

  assert.equal(settings.defaultEmbeddingProfile, "clean_v1");
  assert.deepEqual(settings.storedEmbeddingProfiles, ["clean_v1", "raw_v1"]);
  assert.equal(settings.sidebarProfileMode, "default");
  assert.equal(settings.sidebarSelectedProfile, "clean_v1");
  assert.equal(settings.sidebarCompareLeftProfile, "clean_v1");
  assert.equal(settings.sidebarCompareRightProfile, "raw_v1");
});

test("normalizeRelatedNotesSettings rejects legacy and unknown profile ids for defaults", () => {
  const settings = normalizeRelatedNotesSettings({
    ...DEFAULT_SETTINGS,
    defaultEmbeddingProfile: "legacy_v0",
    storedEmbeddingProfiles: ["legacy_v0", "unknown", "raw_v1"],
    sidebarProfileMode: "compare",
    sidebarSelectedProfile: "legacy_v0",
    sidebarCompareLeftProfile: "unknown",
    sidebarCompareRightProfile: "raw_v1",
  } as any);

  assert.equal(settings.defaultEmbeddingProfile, "clean_v1");
  assert.deepEqual(settings.storedEmbeddingProfiles, ["raw_v1", "clean_v1"]);
  assert.equal(settings.sidebarSelectedProfile, "clean_v1");
  assert.equal(settings.sidebarCompareLeftProfile, "clean_v1");
  assert.equal(settings.sidebarCompareRightProfile, "raw_v1");
});
