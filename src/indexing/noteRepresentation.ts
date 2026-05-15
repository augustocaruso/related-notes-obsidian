import {
  EMBEDDING_PROFILES,
  type EmbeddingProfileId,
} from "../types";
import { sha256 } from "./hash";

const MAX_EMBEDDING_CHARS = 12000;

export function cleanMarkdown(markdown: string): string {
  let text = markdown;

  // 1. Remove YAML frontmatter
  text = text.replace(/^---[\s\S]*?---/, "");

  // 2. Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, "[CODE BLOCK]");

  // 3. Clean Wikilinks [[Note X|Alias]] -> Alias or Note X
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // 4. Remove standard links [Text](URL) -> Text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 5. Remove excessive whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

export function buildNoteRepresentation(input: {
  path: string;
  title: string;
  markdown: string;
  profileId: EmbeddingProfileId;
}): {
  text: string;
  representationHash: string;
  profileId: EmbeddingProfileId;
  profileVersion: number;
} {
  const profile = EMBEDDING_PROFILES[input.profileId];
  const body = buildProfileBody(input.markdown, input.profileId);
  const truncated = body.substring(0, MAX_EMBEDDING_CHARS);
  const text = `Título: ${input.title}\nCaminho: ${input.path}\n\nConteúdo:\n${truncated}`;

  return {
    text,
    representationHash: sha256(text),
    profileId: input.profileId,
    profileVersion: profile.version,
  };
}

export function makePreview(representation: string, limit = 200): string {
    const lines = representation.split("\n");
    const contentStart = lines.findIndex(l => l.startsWith("Conteúdo:"));
    const content = lines.slice(contentStart + 1).join(" ");
    return content.substring(0, limit) + (content.length > limit ? "..." : "");
}

function buildProfileBody(markdown: string, profileId: EmbeddingProfileId): string {
  if (profileId === "raw_v1") return markdown;
  if (profileId === "legacy_v0") return cleanMarkdown(markdown);
  return cleanMarkdownV1(markdown);
}

function cleanMarkdownV1(markdown: string): string {
  const codeBlocks: string[] = [];
  let text = markdown.replace(/```[\s\S]*?```/g, (block) => {
    const token = `@@RELATED_NOTES_CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(block);
    return token;
  });

  text = removeFrontmatter(text);
  text = removeRelatedNotesSection(text);
  text = removeGeneratedFooter(text);
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/!\[\[[^\]]+\]\]/g, "");
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = restoreCodeBlocks(text, codeBlocks);

  return normalizeCleanWhitespace(text);
}

function removeFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
}

function removeRelatedNotesSection(text: string): string {
  const heading = /^##\s+(?:🔗\s+)?Notas Relacionadas\s*$/m;
  const match = heading.exec(text);
  if (!match) return text;
  const nextHeading = /^##\s+/m;
  nextHeading.lastIndex = 0;
  const afterHeading = text.slice(match.index + match[0].length);
  const next = nextHeading.exec(afterHeading);
  const end = next ? match.index + match[0].length + next.index : text.length;
  return `${text.slice(0, match.index)}${text.slice(end)}`;
}

function removeGeneratedFooter(text: string): string {
  const footer = /\n---\s*\n(?:Gerado|Generated|Exportado|Fonte|Source|Criado|Created)[\s\S]*$/i;
  return text.replace(footer, "");
}

function restoreCodeBlocks(text: string, codeBlocks: string[]): string {
  return text.replace(/@@RELATED_NOTES_CODE_BLOCK_(\d+)@@/g, (_token, indexText: string) => {
    const index = Number(indexText);
    return codeBlocks[index] ?? "";
  });
}

function normalizeCleanWhitespace(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
