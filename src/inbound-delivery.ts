import type {
  ChannelOutboundAdapter,
  OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import type {
  InboundDeliveryAdapter,
  InboundDeliveryRequest,
  InboundDeliveryResult,
} from "./types.js";

export type DeliveryLogger = {
  info?: (message: string) => void;
  debug?: (message: string) => void;
  warn?: (message: string) => void;
};

export type LoadChannelOutboundAdapter = (
  channel: string,
) => Promise<ChannelOutboundAdapter | undefined>;

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createOpenClawRuntimeInboundDelivery(options: {
  config: OpenClawConfig;
  loadAdapter: LoadChannelOutboundAdapter;
  logger?: DeliveryLogger;
}): InboundDeliveryAdapter {
  const { config, loadAdapter, logger } = options;

  return {
    async deliver(request: InboundDeliveryRequest): Promise<InboundDeliveryResult> {
      logger?.debug?.(
        `[libp2p-mesh] Forwarding inbound delivery via runtime channel adapter: ${request.channel}/${request.target}`,
      );

      const adapter = await loadAdapter(request.channel);
      if (!adapter?.sendText) {
        return {
          ok: false,
          channel: request.channel,
          target: request.target,
          error: `channel ${request.channel} does not expose runtime text delivery`,
        };
      }

      try {
        await adapter.sendText({
          cfg: config,
          to: request.target,
          text: request.text,
        });
      } catch (error) {
        return {
          ok: false,
          channel: request.channel,
          target: request.target,
          error: summarizeError(error),
        };
      }

      logger?.info?.(
        `[libp2p-mesh] Delivered inbound message to ${request.channel}/${request.target}`,
      );
      return {
        ok: true,
        channel: request.channel,
        target: request.target,
      };
    },
  };
}
