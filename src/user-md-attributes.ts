import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { UserPublicAttribute } from "./types.js";
import { normalizeAttributeValue } from "./user-attributes.js";

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

const FIELD_PREFIX_PATTERN =
  /^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:name|what to call them|notes?|context|project|projects|skills?|interests?)\s*[:：-]\s*/i;
const FIELD_LINE_PATTERN =
  /^(?:[-*]\s*)?(?:#{1,6}\s*)?(name|what to call them|notes?|context|project|projects|skills?|interests?)\s*[:：-]\s*(.*)$/i;
const TEMPLATE_PATTERN =
  /\b(?:todo|tbd|n\/a|none|unknown|your name|add notes here|template placeholder|placeholder)\b/i;
const EXPLICIT_LIST_SEPARATOR_PATTERN = /[,，、;；|/]/;
const ENGLISH_TAG_PATTERN = /^(?:[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)?|libp2p|node\.js)$/i;
const TECH_TOKEN_PATTERN = /\b(?:[A-Z][A-Z0-9]{1,}|[A-Za-z]*[0-9][A-Za-z0-9]*|libp2p|node\.js)\b/g;
const CHINESE_TAG_PATTERN = /[\p{Script=Han}]{2,8}/gu;
const CHINESE_CONTEXT_PATTERNS = [
  /(?:在|来自|加入|参与|负责)([\p{Script=Han}]{2,8})(?:做|写|用|项目|团队|实验室|方向)?/gu,
  /(?:做|写|维护|负责|参与)([\p{Script=Han}]{2,8})(?:项目|插件|工具|方向)?/gu,
];
const CHINESE_SENTENCE_WORD_PATTERN =
  /(?:今天|明天|昨天|今晚|晚上|早上|上午|下午|八点|同步|一下|进展|开会|讨论|安排|提醒|需要|已经|可以|应该|我们|你们|他们)/u;
const CHINESE_STOP_WORDS = new Set([
  "关于",
  "正在",
  "当前",
  "相关",
  "工作",
  "项目",
  "网络",
  "专注",
]);
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
const ENGLISH_TAG_FIELDS = new Set([
  "name",
  "what to call them",
  "project",
  "projects",
  "skill",
  "skills",
  "interest",
  "interests",
]);
const TECH_TOKEN_FIELDS = new Set([
  "notes",
  "note",
  "context",
  "project",
  "projects",
  "skill",
  "skills",
  "interest",
  "interests",
]);

export type UserMdAttributeSource = {
  path?: string;
  logger?: {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
  };
};

export function resolveUserMdPath(customPath?: string): string {
  if (customPath) {
    return customPath;
  }

  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    return path.join(stateDir, "workspace", "USER.md");
  }

  return path.join(homedir(), ".openclaw", "workspace", "USER.md");
}

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

function isStableChineseCandidate(value: string): boolean {
  return (
    /^[\p{Script=Han}]{2,8}$/u.test(value) &&
    !CHINESE_STOP_WORDS.has(value) &&
    !CHINESE_SENTENCE_WORD_PATTERN.test(value)
  );
}

function collectTechnicalTokens(value: string): string[] {
  const tokens: string[] = [];

  for (const match of value.matchAll(TECH_TOKEN_PATTERN)) {
    const token = trimCandidate(match[0] ?? "");
    if (isStableEnglishCandidate(token)) {
      tokens.push(token);
    }
  }

  return tokens;
}

function collectChineseCandidates(value: string): string[] {
  const candidates: string[] = [];

  for (const match of value.matchAll(CHINESE_TAG_PATTERN)) {
    const candidate = trimChineseCandidate(match[0]);
    if (isStableChineseCandidate(candidate)) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function looksLikeSentence(value: string): boolean {
  return /[。.!?]/.test(value) || value.split(/\s+/).filter(Boolean).length > 4;
}

function fieldValue(line: string): { field: string; value: string } | undefined {
  const match = line.match(FIELD_LINE_PATTERN);
  if (!match) {
    return undefined;
  }

  return {
    field: (match[1] ?? "").toLowerCase(),
    value: stripMarkdown(match[2] ?? ""),
  };
}

function isStableEnglishCandidate(value: string): boolean {
  const candidate = trimCandidate(value).replace(/^(?:and|or)\s+/i, "");
  return (
    ENGLISH_TAG_PATTERN.test(candidate) &&
    !COMMON_WORDS.has(candidate.toLowerCase()) &&
    !/^\d+$/.test(candidate)
  );
}

function allowsEnglishTags(field: string | undefined): boolean {
  return field !== undefined && ENGLISH_TAG_FIELDS.has(field);
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
  const explicitField = fieldValue(line);
  const explicitFieldValue = explicitField?.value;

  if (explicitField && TECH_TOKEN_FIELDS.has(explicitField.field)) {
    candidates.push(...collectTechnicalTokens(explicitField.value));
  }

  if (/^[\p{Script=Han}]{2,8}$/u.test(text) && isStableChineseCandidate(text)) {
    candidates.push(text);
  }

  if (EXPLICIT_LIST_SEPARATOR_PATTERN.test(text)) {
    for (const part of text.split(EXPLICIT_LIST_SEPARATOR_PATTERN)) {
      candidates.push(...collectChineseCandidates(part));
      if (explicitFieldValue && allowsEnglishTags(explicitField?.field)) {
        const value = trimCandidate(part).replace(/^(?:and|or)\s+/i, "");
        if (isStableEnglishCandidate(value)) {
          candidates.push(value);
        }
      }
    }
  }

  for (const pattern of CHINESE_CONTEXT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = trimChineseCandidate(match[1] ?? "");
      if (isStableChineseCandidate(value)) {
        candidates.push(value);
      }
    }
  }

  if (
    explicitField &&
    allowsEnglishTags(explicitField.field) &&
    !EXPLICIT_LIST_SEPARATOR_PATTERN.test(explicitField.value) &&
    !looksLikeSentence(explicitField.value)
  ) {
    const value = trimCandidate(explicitField.value).replace(/^(?:and|or)\s+/i, "");
    if (isStableEnglishCandidate(value)) {
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
  const filePath = resolveUserMdPath(options?.path);
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
