import type { UserPublicAttribute } from "./types.js";
export type UserProfile = {
    version: 1;
    updatedAt: number;
    attributes: UserPublicAttribute[];
};
export type UserProfileLogger = {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
};
export type UserProfileAttributeTarget = string | number;
export type UserProfileStore = {
    load(): Promise<UserProfile>;
    save(profile: UserProfile): Promise<UserProfile>;
    listAttributes(): Promise<UserPublicAttribute[]>;
    replaceAttributes(attributes: UserPublicAttribute[]): Promise<UserProfile>;
    updateAttribute(target: UserProfileAttributeTarget, attribute: UserPublicAttribute): Promise<UserProfile>;
    removeAttribute(target: UserProfileAttributeTarget): Promise<UserProfile>;
};
export declare function resolveUserProfilePath(customPath?: string): string;
export declare function getUserProfileAttributeId(attribute: UserPublicAttribute): string;
export declare function createUserProfileStore(options?: {
    path?: string;
    logger?: UserProfileLogger;
}): UserProfileStore;
