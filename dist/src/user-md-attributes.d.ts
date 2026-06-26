import type { UserPublicAttribute } from "./types.js";
export type UserMdAttributeSource = {
    path?: string;
    logger?: {
        debug?: (message: string) => void;
        warn?: (message: string) => void;
    };
};
export declare function resolveUserMdPath(customPath?: string): string;
export declare function extractUserMdTags(markdown: string): UserPublicAttribute[];
export declare function createUserMdAttributeSource(options?: UserMdAttributeSource): {
    loadTags(): Promise<UserPublicAttribute[]>;
};
