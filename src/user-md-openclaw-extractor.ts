import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { UserPublicAttribute } from "./types.js";
import type {
  UserMdAttributeExtractionUnavailable,
  UserMdAttributeExtractor,
} from "./user-md-agent-attributes.js";
import { validateExtractedUserMdTags } from "./user-md-agent-attributes.js";

const EXTRACTION_TIMEOUT_MS = 30000;

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

type RuntimeLlmComplete = {
  complete(request: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    purpose: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<unknown>;
};

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

export function extractCompletionText(result: unknown): string | undefined {
  if (typeof result === "string") {
    return result;
  }
  if (!isRecord(result)) {
    return undefined;
  }

  const direct =
    extractTextFromContent(result.content) ??
    (typeof result.text === "string" ? result.text : undefined) ??
    (typeof result.outputText === "string" ? result.outputText : undefined) ??
    (typeof result.message === "string" ? result.message : undefined);
  if (direct?.trim()) {
    return direct;
  }

  const choices = result.choices;
  if (!Array.isArray(choices)) {
    return undefined;
  }

  for (const choice of choices) {
    if (!isRecord(choice)) {
      continue;
    }
    const message = choice.message;
    if (isRecord(message)) {
      const text = extractTextFromContent(message.content);
      if (text?.trim()) {
        return text;
      }
    }
    const text = extractTextFromContent(choice.content);
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

function runtimeLlm(api: OpenClawPluginApi): RuntimeLlmComplete | undefined {
  const runtime = api.runtime as unknown;
  if (!isRecord(runtime)) {
    return undefined;
  }
  const llm = runtime.llm;
  if (!isRecord(llm) || typeof llm.complete !== "function") {
    return undefined;
  }
  return llm as RuntimeLlmComplete;
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
      const llm = runtimeLlm(api);
      if (!llm) {
        return unavailable("OpenClaw runtime llm.complete is unavailable");
      }

      try {
        const result = await llm.complete({
          messages: [
            { role: "system", content: USER_MD_ATTRIBUTE_EXTRACTION_PROMPT },
            { role: "user", content: buildUserMdExtractionMessage(markdown, sourcePath) },
          ],
          purpose: "libp2p-mesh.user-md-attributes",
          maxTokens: 512,
          temperature: 0.1,
          timeoutMs,
        });
        const text = extractCompletionText(result);
        if (!text) {
          return [];
        }

        return parseUserMdAttributeResponse(text);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger?.warn?.(`[libp2p-mesh] USER.md agent extraction failed: ${reason}`);
        return unavailable(reason);
      }
    },
  };
}
