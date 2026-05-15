import assert from "node:assert/strict";
import test from "node:test";
import { RelatedNotesService } from "../../src/related/RelatedNotesService";

test("RelatedNotesService returns not_indexed per selected profile", async () => {
  const store = {
    getNote: async (_path: string, profileId: string) =>
      profileId === "raw_v1" ? { path: "A.md", vector: [1, 0] } : null,
    searchSimilar: async () => [],
  };
  const service = new RelatedNotesService(store as any);

  const clean = await service.getRelatedNotes("A.md", 10, "clean_v1");
  const raw = await service.getRelatedNotes("A.md", 10, "raw_v1");

  assert.equal(clean.status, "not_indexed");
  assert.equal(raw.status, "ok");
});

test("RelatedNotesService searches only within the selected profile", async () => {
  let searchedProfile = "";
  const store = {
    getNote: async () => ({ path: "A.md", vector: [1, 0] }),
    searchSimilar: async (_vector: number[], options: { profileId: string }) => {
      searchedProfile = options.profileId;
      return [{ path: "B.md", title: "B", score: 0.9 }];
    },
  };
  const service = new RelatedNotesService(store as any);

  const result = await service.getRelatedNotes("A.md", 10, "clean_v1");

  assert.equal(result.status, "ok");
  assert.equal(searchedProfile, "clean_v1");
  assert.deepEqual(result.notes.map((note) => note.path), ["B.md"]);
});
