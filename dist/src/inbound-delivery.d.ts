import type { ChannelOutboundAdapter, OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { InboundDeliveryAdapter } from "./types.js";
export type DeliveryLogger = {
    info?: (message: string) => void;
    debug?: (message: string) => void;
    warn?: (message: string) => void;
};
export type LoadChannelOutboundAdapter = (channel: string) => Promise<ChannelOutboundAdapter | undefined>;
export declare function createOpenClawRuntimeInboundDelivery(options: {
    config: OpenClawConfig;
    loadAdapter: LoadChannelOutboundAdapter;
    logger?: DeliveryLogger;
}): InboundDeliveryAdapter;
