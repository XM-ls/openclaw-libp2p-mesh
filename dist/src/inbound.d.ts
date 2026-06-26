import type { P2PMessage } from "./types.js";
export type InboundHandlerDeps = {
    logger?: {
        info?: (msg: string) => void;
        debug?: (msg: string) => void;
        warn?: (msg: string) => void;
        error?: (msg: string) => void;
    };
    sendToChannel?: (channelId: string, target: string, text: string) => Promise<void>;
};
export declare function handleP2PInbound(msg: P2PMessage, deps: InboundHandlerDeps): void;
