import { createHash } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { UserPublicAttribute } from "./types.js";
import type {
  UserMdAttributeExtractionUnavailable,
  UserMdAttributeExtractor,
} from "./user-md-agent-attributes.js";
import { validateExtractedUserMdTags } from "./user-md-agent-attributes.js";

const EXTRACTION_TIMEOUT_MS = 30000;
const SESSION_HASH_LENGTH = 16;

export const USER_MD_ATTRIBUTE_EXTRACTION_PROMPT = [
  "你是 libp2p-mesh 的 USER.md 公开属性提取器。",
  "",
  "任务：从 USER.md 中提取少量适合公开广播的用户 tag。",
  "",
  "规则：",
  "- 只输出 JSON 数组，不要输出解释、Markdown 或代码块。",
  '- 每项必须是：{"kind":"tag","value":"...","label":"...","source":"USER.md"}',
  "- 最多 10 个。",
  "- 每个 value 不超过 40 个字符。",
  "- 不要提取寒暄、联系方式提示、占位内容、完整句子。",
  "- 不要提取“刚认识”“还在了解”“随时告诉我”这类无分类价值内容。",
  "- 优先提取稳定身份、技术方向、项目方向、长期偏好。",
].join("\n");

type Logger = {
  warn?: (message: string) => void;
};

function hashForSessionKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, SESSION_HASH_LENGTH);
}

function buildUserMdExtractionMessage(markdown: string, sourcePath: string): string {
  return [
    `sourcePath: ${sourcePath}`,
    "",
    "USER.md:",
    "```md",
    markdown,
    "```",
    "",
    "只输出 JSON 数组。",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!isRecord(item)) {
      continue;
    }
    if (typeof item.text === "string") {
      parts.push(item.text);
      continue;
    }
    if (typeof item.content === "string") {
      parts.push(item.content);
    }
  }

  return parts.length > 0 ? parts.join("") : undefined;
}

export function extractLatestAssistantText(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "assistant") {
      continue;
    }

    const text =
      extractTextFromContent(message.content) ??
      (typeof message.text === "string" ? message.text : undefined) ??
      (typeof message.message === "string" ? message.message : undefined);
    if (text?.trim()) {
      return text;
    }
  }

  return undefined;
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseUserMdAttributeResponse(text: string): UserPublicAttribute[] {
  try {
    return validateExtractedUserMdTags(JSON.parse(stripJsonFence(text)));
  } catch {
    return [];
  }
}

function unavailable(reason: string): UserMdAttributeExtractionUnavailable {
  return { unavailable: true, reason };
}

export function createOpenClawUserMdAttributeExtractor(
  api: OpenClawPluginApi,
  options?: {
    timeoutMs?: number;
    logger?: Logger;
  },
): UserMdAttributeExtractor {
  const timeoutMs = options?.timeoutMs ?? EXTRACTION_TIMEOUT_MS;
  const logger = options?.logger ?? api.logger;

  return {
    async extract({ markdown, sourcePath }) {
      const subagent = api.runtime?.subagent;
      if (!subagent?.run || !subagent.waitForRun || !subagent.getSessionMessages) {
        return unavailable("OpenClaw subagent runtime is unavailable");
      }

      const sessionKey = `libp2p-mesh:user-md-attributes:${hashForSessionKey(sourcePath)}`;

      try {
        await subagent.deleteSession?.({ sessionKey, deleteTranscript: true }).catch(() => undefined);
        const { runId } = await subagent.run({
          sessionKey,
          message: buildUserMdExtractionMessage(markdown, sourcePath),
          extraSystemPrompt: USER_MD_ATTRIBUTE_EXTRACTION_PROMPT,
          lane: "libp2p-mesh-user-md-attributes",
          lightContext: true,
          deliver: false,
        });

        const waitResult = await subagent.waitForRun({ runId, timeoutMs });
        if (waitResult.status !== "ok") {
          return unavailable(waitResult.error ?? `OpenClaw subagent extraction ${waitResult.status}`);
        }

        const { messages } = await subagent.getSessionMessages({ sessionKey, limit: 10 });
        const text = extractLatestAssistantText(messages);
        if (!text) {
          return [];
        }

        return parseUserMdAttributeResponse(text);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger?.warn?.(`[libp2p-mesh] USER.md agent extraction failed: ${reason}`);
        return unavailable(reason);
      } finally {
        await subagent.deleteSession?.({ sessionKey, deleteTranscript: true }).catch(() => undefined);
      }
    },
  };
}
