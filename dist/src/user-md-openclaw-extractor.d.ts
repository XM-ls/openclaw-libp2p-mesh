import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { UserPublicAttribute } from "./types.js";
import type { UserMdAttributeExtractor } from "./user-md-agent-attributes.js";
export declare const USER_MD_ATTRIBUTE_EXTRACTION_PROMPT: string;
type Logger = {
    warn?: (message: string) => void;
};
export declare function extractLatestAssistantText(messages: unknown[]): string | undefined;
export declare function extractCompletionText(result: unknown): string | undefined;
export declare function parseUserMdAttributeResponse(text: string): UserPublicAttribute[];
export declare function createOpenClawUserMdAttributeExtractor(api: OpenClawPluginApi, options?: {
    timeoutMs?: number;
    logger?: Logger;
}): UserMdAttributeExtractor;
export {};
