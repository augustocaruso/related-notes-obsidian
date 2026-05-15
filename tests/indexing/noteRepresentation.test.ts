import assert from "node:assert/strict";
import test from "node:test";
import { buildNoteRepresentation } from "../../src/indexing/noteRepresentation";

const markdown = `---
tags:
  - cardio
---
# Hipertensão

Texto com [[Pressão arterial|PA]] e [diretriz](https://example.com).

![fluxo](imagem.png)
![[Anexo.png]]
<!-- gemini-artifact source -->

\`\`\`ts
const link = "[não alterar](code)";
\`\`\`

| A | B |
|---|---|
| 1 | 2 |

## 🔗 Notas Relacionadas
- [[Ruído]]

## Próxima seção
Conteúdo depois.

---
Gerado automaticamente.
`;

test("clean_v1 removes generated scaffolding while preserving semantic structure", () => {
  const representation = buildNoteRepresentation({
    path: "Cardio/HAS.md",
    title: "HAS",
    markdown,
    profileId: "clean_v1",
  });

  assert.equal(representation.profileId, "clean_v1");
  assert.equal(representation.profileVersion, 1);
  assert.match(representation.text, /Título: HAS/);
  assert.match(representation.text, /Caminho: Cardio\/HAS\.md/);
  assert.doesNotMatch(representation.text, /tags:/);
  assert.doesNotMatch(representation.text, /Notas Relacionadas/);
  assert.doesNotMatch(representation.text, /Anexo\.png/);
  assert.doesNotMatch(representation.text, /gemini-artifact/);
  assert.doesNotMatch(representation.text, /Gerado automaticamente/);
  assert.match(representation.text, /PA/);
  assert.match(representation.text, /diretriz/);
  assert.match(representation.text, /```ts\nconst link = "\[não alterar\]\(code\)";\n```/);
  assert.match(representation.text, /\| A \| B \|/);
  assert.match(representation.text, /## Próxima seção/);
});

test("raw_v1 preserves raw markdown noise for comparison", () => {
  const representation = buildNoteRepresentation({
    path: "Cardio/HAS.md",
    title: "HAS",
    markdown,
    profileId: "raw_v1",
  });

  assert.equal(representation.profileId, "raw_v1");
  assert.match(representation.text, /tags:/);
  assert.match(representation.text, /## 🔗 Notas Relacionadas/);
  assert.match(representation.text, /!\[\[Anexo\.png\]\]/);
  assert.match(representation.text, /gemini-artifact/);
  assert.match(representation.text, /```ts/);
  assert.match(representation.text, /\| A \| B \|/);
});

test("legacy_v0 preserves the old hybrid representation behavior", () => {
  const representation = buildNoteRepresentation({
    path: "Cardio/HAS.md",
    title: "HAS",
    markdown,
    profileId: "legacy_v0",
  });

  assert.equal(representation.profileId, "legacy_v0");
  assert.doesNotMatch(representation.text, /tags:/);
  assert.match(representation.text, /\[CODE BLOCK\]/);
  assert.doesNotMatch(representation.text, /```ts/);
});

test("raw_v1 and clean_v1 produce different hashes when scaffolding exists", () => {
  const raw = buildNoteRepresentation({
    path: "Cardio/HAS.md",
    title: "HAS",
    markdown,
    profileId: "raw_v1",
  });
  const clean = buildNoteRepresentation({
    path: "Cardio/HAS.md",
    title: "HAS",
    markdown,
    profileId: "clean_v1",
  });

  assert.notEqual(raw.representationHash, clean.representationHash);
});
