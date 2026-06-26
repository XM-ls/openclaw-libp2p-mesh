import type { UserAttributeMatch, UserPublicAttribute } from "./types.js";
export declare function normalizeAttributeValue(value: string): string;
export declare function normalizeAttributeKey(key: string): string;
export declare function normalizeUserPublicAttribute(value: unknown): UserPublicAttribute | undefined;
export declare function mergeUserPublicAttributes(userMdTags: UserPublicAttribute[], profileAttributes: UserPublicAttribute[]): UserPublicAttribute[];
export declare function matchesUserAttribute(attribute: UserPublicAttribute, match: UserAttributeMatch): boolean;
