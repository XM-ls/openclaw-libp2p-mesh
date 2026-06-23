import { readFile } from "node:fs/promises";
import path from "node:path";

import type { UserPublicAttribute } from "./types.js";
import { normalizeAttributeValue } from "./user-attributes.js";

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

const FIELD_PREFIX_PATTERN =
  /^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:name|what to call them|notes?|context|project|projects|skills?|interests?)\s*[:：-]\s*/i;
const TEMPLATE_PATTERN =
  /\b(?:todo|tbd|n\/a|none|unknown|your name|add notes here|template placeholder|placeholder)\b/i;
const COMMON_WORDS = new Set([
  "and",
  "also",
  "with",
  "works",
  "work",
  "interested",
  "in",
  "the",
  "for",
  "user",
  "name",
  "notes",
  "context",
  "project",
  "projects",
  "skills",
]);

export type UserMdAttributeSource = {
  path?: string;
  logger?: {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
  };
};

function isTemplateText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || TEMPLATE_PATTERN.test(trimmed) || /^\[[^\]]+\]$/.test(trimmed);
}

function stripMarkdown(line: string): string {
  return line
    .replace(FIELD_PREFIX_PATTERN, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~#>]/g, " ")
    .trim();
}

function trimCandidate(value: string): string {
  return value
    .replace(/^[\s"'“”‘’()[\]{}<>，。；：、,.;:!?/\\|-]+/, "")
    .replace(/[\s"'“”‘’()[\]{}<>，。；：、,.;:!?/\\|-]+$/, "")
    .trim();
}

function trimChineseCandidate(value: string): string {
  return trimCandidate(value)
    .replace(/^(?:我|俺|在|和|与|跟|做|写|用|是|的|也|经常|正在|参与)+/u, "")
    .replace(/(?:做|写|用|是|的|了|中|相关|项目|插件)+$/u, "")
    .trim();
}

function looksLikeSentence(value: string): boolean {
  return /[。.!?]/.test(value) || value.split(/\s+/).filter(Boolean).length > 4;
}

function isValidTagCandidate(value: string): boolean {
  if (!value || value.length > MAX_TAG_LENGTH || isTemplateText(value) || looksLikeSentence(value)) {
    return false;
  }

  if (/^\d+$/.test(value)) {
    return false;
  }

  return true;
}

function pushTag(tags: UserPublicAttribute[], seen: Set<string>, rawValue: string): void {
  const value = trimCandidate(rawValue);
  if (!isValidTagCandidate(value)) {
    return;
  }

  const key = normalizeAttributeValue(value);
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  tags.push({
    kind: "tag",
    value,
    label: value,
    source: "USER.md",
  });
}

function collectCandidates(line: string): string[] {
  const candidates: string[] = [];
  const text = stripMarkdown(line);
  if (isTemplateText(text)) {
    return candidates;
  }

  for (const match of text.matchAll(/[\p{Script=Han}]{2,16}/gu)) {
    const value = trimChineseCandidate(match[0]);
    if (value) {
      candidates.push(value);
    }
  }

  for (const match of text.matchAll(/\b(?:[A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)?|libp2p|node\.js)\b/g)) {
    const value = match[0];
    if (!COMMON_WORDS.has(value.toLowerCase())) {
      candidates.push(value);
    }
  }

  return candidates;
}

export function extractUserMdTags(markdown: string): UserPublicAttribute[] {
  const tags: UserPublicAttribute[] = [];
  const seen = new Set<string>();

  for (const line of markdown.split(/\r?\n/)) {
    for (const candidate of collectCandidates(line)) {
      pushTag(tags, seen, candidate);
      if (tags.length >= MAX_TAGS) {
        return tags;
      }
    }
  }

  return tags;
}

export function createUserMdAttributeSource(options?: UserMdAttributeSource): {
  loadTags(): Promise<UserPublicAttribute[]>;
} {
  const filePath = options?.path ?? path.join(process.cwd(), "USER.md");
  const logger = options?.logger;

  return {
    async loadTags(): Promise<UserPublicAttribute[]> {
      try {
        return extractUserMdTags(await readFile(filePath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }

        logger?.warn?.(`[libp2p-mesh] Failed to read USER.md at ${filePath}: ${(error as Error).message}`);
        return [];
      }
    },
  };
}
