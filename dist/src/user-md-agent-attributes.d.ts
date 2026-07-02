import type { UserMdAttributeSource, UserPublicAttribute } from "./types.js";
type Logger = {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
};
export type UserMdAttributeExtractionUnavailable = {
    unavailable: true;
    reason: string;
};
export type UserMdAttributeExtractor = {
    extract(request: {
        markdown: string;
        sourcePath: string;
    }): Promise<UserPublicAttribute[] | UserMdAttributeExtractionUnavailable>;
};
export declare function resolveUserMdAttributeCachePath(customPath?: string): string;
export declare function validateExtractedUserMdTags(value: unknown): UserPublicAttribute[];
export declare function createUserMdAgentAttributeSource(options?: {
    path?: string;
    cachePath?: string;
    extractor?: UserMdAttributeExtractor;
    logger?: Logger;
}): UserMdAttributeSource;
export {};
