export function resolveDiscoveryConfig(config) {
    return {
        enabled: true,
        mechanism: config?.discovery ?? "mdns",
        bootstrapList: config?.bootstrapList ?? [],
    };
}
//# sourceMappingURL=discovery.js.map