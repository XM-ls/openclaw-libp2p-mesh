import type { InstancePeerStore } from "./types.js";
export interface StoreLogger {
    info?(message: string): void;
    debug?(message: string): void;
    warn?(message: string): void;
}
export declare function resolveInstancePeerPath(customPath?: string): string;
export declare function createInstancePeerStore(options?: {
    path?: string;
    logger?: StoreLogger;
}): InstancePeerStore;
