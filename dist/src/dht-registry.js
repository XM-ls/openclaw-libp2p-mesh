/**
 * DHT-based public key registry for cross-instance identity verification.
 *
 * Each OpenClaw instance publishes its Ed25519 pubkey to the DHT under the key:
 *   openclaw:pubkey:<instanceId>
 *
 * Other instances can look up this pubkey to verify message signatures.
 */
const DHT_KEY_PREFIX = "openclaw:pubkey:";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const pubkeyCache = new Map();
function encodeKey(instanceId) {
    return new TextEncoder().encode(`${DHT_KEY_PREFIX}${instanceId}`);
}
/**
 * Register this instance's pubkey in the DHT.
 * Other nodes can later look it up to verify signatures from this instance.
 */
export async function registerPubkey(dht, instanceId, pubkey, logger) {
    const key = encodeKey(instanceId);
    const value = new TextEncoder().encode(pubkey);
    try {
        for await (const event of dht.put(key, value)) {
            // Drain the async iterable; put completes when the iterable ends
            logger?.info?.(`[dht-registry] put event: ${event.name}`);
        }
        logger?.info?.(`[dht-registry] Registered pubkey for ${instanceId}`);
    }
    catch (err) {
        logger?.warn?.(`[dht-registry] Failed to register pubkey: ${String(err)}`);
        // Non-fatal: identity verification may degrade but mesh continues
    }
}
/**
 * Look up a pubkey from the DHT for the given instanceId.
 * Results are cached locally to avoid repeated DHT queries.
 */
export async function lookupPubkey(dht, instanceId, logger) {
    // 1. Check local cache
    const cached = pubkeyCache.get(instanceId);
    if (cached && cached.expiry > Date.now()) {
        logger?.debug?.(`[dht-registry] Cache hit for ${instanceId}`);
        return cached.pubkey;
    }
    // 2. Query DHT
    const key = encodeKey(instanceId);
    try {
        for await (const event of dht.get(key)) {
            if (event.name === "VALUE") {
                const pubkey = new TextDecoder().decode(event.value);
                pubkeyCache.set(instanceId, {
                    pubkey,
                    expiry: Date.now() + CACHE_TTL_MS,
                });
                logger?.info?.(`[dht-registry] DHT lookup success for ${instanceId}`);
                return pubkey;
            }
        }
    }
    catch (err) {
        logger?.warn?.(`[dht-registry] DHT lookup failed for ${instanceId}: ${String(err)}`);
    }
    logger?.info?.(`[dht-registry] No pubkey found for ${instanceId}`);
    return undefined;
}
/**
 * Clear the local pubkey cache.
 */
export function clearPubkeyCache() {
    pubkeyCache.clear();
}
/**
 * Get cache stats for observability.
 */
export function getCacheStats() {
    return {
        size: pubkeyCache.size,
        keys: Array.from(pubkeyCache.keys()),
    };
}
//# sourceMappingURL=dht-registry.js.map