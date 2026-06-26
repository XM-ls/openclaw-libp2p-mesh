/**
 * DHT-based public key registry for cross-instance identity verification.
 *
 * Each OpenClaw instance publishes its Ed25519 pubkey to the DHT under the key:
 *   openclaw:pubkey:<instanceId>
 *
 * Other instances can look up this pubkey to verify message signatures.
 */
import type { KadDHT } from "@libp2p/kad-dht";
/**
 * Register this instance's pubkey in the DHT.
 * Other nodes can later look it up to verify signatures from this instance.
 */
export declare function registerPubkey(dht: KadDHT, instanceId: string, pubkey: string, logger?: {
    info?: (msg: string) => void;
    debug?: (msg: string) => void;
    warn?: (msg: string) => void;
}): Promise<void>;
/**
 * Look up a pubkey from the DHT for the given instanceId.
 * Results are cached locally to avoid repeated DHT queries.
 */
export declare function lookupPubkey(dht: KadDHT, instanceId: string, logger?: {
    info?: (msg: string) => void;
    debug?: (msg: string) => void;
    warn?: (msg: string) => void;
}): Promise<string | undefined>;
/**
 * Clear the local pubkey cache.
 */
export declare function clearPubkeyCache(): void;
/**
 * Get cache stats for observability.
 */
export declare function getCacheStats(): {
    size: number;
    keys: string[];
};
