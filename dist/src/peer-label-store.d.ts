import type { PeerLabelStore } from "./types.js";
type PeerLabelStoreLogger = {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
};
export declare function resolvePeerLabelsPath(customPath?: string): string;
export declare function createPeerLabelStore(options?: {
    path?: string;
    logger?: PeerLabelStoreLogger;
}): PeerLabelStore;
export {};
