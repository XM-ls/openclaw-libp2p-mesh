/**
 * Lightweight Instance Identity module inspired by BAID (Binding Agent ID).
 *
 * BAID core idea: bind multiple identity dimensions (name, code, profile, user)
 * into a single cryptographic identity.
 *
 * Our lightweight adaptation:
 * - Ed25519 keypair for self-sovereign identity (provable via signatures)
 * - Multi-dimensional binding hash: username + hostname + platform
 * - InstanceID format: name@<pubkey_b64url[0:12]>.<binding[0:8]>
 * - Persistent storage in ~/.openclaw/libp2p/instance-id.json
 */
export interface InstanceIdentity {
    /** Full InstanceID string, e.g. "alice-mac@AQIDBAUGBweI.7a3f9e2b" */
    id: string;
    /** Human-readable instance name */
    name: string;
    /** Base64url-encoded Ed25519 public key (SPKI/DER) */
    pubkey: string;
    /** Hex SHA-256 binding hash of environment dimensions */
    binding: string;
    /** Components that contributed to the binding hash */
    bindingComponents: {
        username: string;
        hostname: string;
        platform: string;
    };
    /** Timestamp when the identity was created */
    createdAt: number;
}
interface PersistedIdentity extends InstanceIdentity {
    /** Base64url-encoded Ed25519 private key (PKCS8/DER) — stored for signing */
    privkey: string;
}
export interface InstanceIDOptions {
    /** Custom instance name (defaults to "<username>-<hostname>") */
    name?: string;
    /** Custom storage path for the identity file */
    customPath?: string;
}
export declare function generateInstanceIdentity(options?: InstanceIDOptions): PersistedIdentity;
export declare function loadOrCreateInstanceIdentity(options?: InstanceIDOptions): Promise<{
    identity: InstanceIdentity;
    signMessage: (message: string) => string;
}>;
export declare function verifyInstanceSignature(identity: InstanceIdentity, message: string, signature: string): boolean;
export declare function verifyInstanceIDBinding(identity: InstanceIdentity): {
    valid: boolean;
    currentBinding: string;
    mismatch?: string;
};
export declare function formatInstanceIDForDisplay(identity: InstanceIdentity): string;
export {};
