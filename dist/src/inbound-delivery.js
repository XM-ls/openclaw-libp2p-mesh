function summarizeError(error) {
    return error instanceof Error ? error.message : String(error);
}
export function createOpenClawRuntimeInboundDelivery(options) {
    const { config, loadAdapter, logger } = options;
    return {
        async deliver(request) {
            logger?.debug?.(`[libp2p-mesh] Forwarding inbound delivery via runtime channel adapter: ${request.channel}/${request.target}`);
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
            }
            catch (error) {
                return {
                    ok: false,
                    channel: request.channel,
                    target: request.target,
                    error: summarizeError(error),
                };
            }
            logger?.info?.(`[libp2p-mesh] Delivered inbound message to ${request.channel}/${request.target}`);
            return {
                ok: true,
                channel: request.channel,
                target: request.target,
            };
        },
    };
}
//# sourceMappingURL=inbound-delivery.js.map