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

import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, hostname, platform, userInfo } from "node:os";
import path from "node:path";

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

function resolveInstanceIDPath(customPath?: string): string {
  if (customPath) return customPath;
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    return path.join(stateDir, "libp2p", "instance-id.json");
  }
  return path.join(homedir(), ".openclaw", "libp2p", "instance-id.json");
}

function getBindingComponents(): InstanceIdentity["bindingComponents"] {
  let username: string;
  try {
    username = userInfo().username;
  } catch {
    username = process.env.USER || process.env.USERNAME || "unknown";
  }
  return {
    username,
    hostname: hostname(),
    platform: platform(),
  };
}

function computeBindingHash(
  components: InstanceIdentity["bindingComponents"],
): string {
  const data = `${components.username}::${components.hostname}::${components.platform}`;
  return createHash("sha256").update(data).digest("hex");
}

function getDefaultName(): string {
  const { username, hostname: h } = getBindingComponents();
  const shortHost = h.split(".")[0];
  return `${username}-${shortHost}`;
}

function generateEd25519KeyPair(): { publicKey: Buffer; privateKey: Buffer } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return { publicKey: Buffer.from(publicKey), privateKey: Buffer.from(privateKey) };
}

function pubkeyShort(pubkey: Buffer): string {
  return pubkey.toString("base64url").slice(0, 12);
}

function bindingShort(binding: string): string {
  return binding.slice(0, 8);
}

export function generateInstanceIdentity(options: InstanceIDOptions = {}): PersistedIdentity {
  const name = options.name?.trim() || getDefaultName();
  const { publicKey, privateKey } = generateEd25519KeyPair();
  const bindingComponents = getBindingComponents();
  const binding = computeBindingHash(bindingComponents);

  const id = `${name}@${pubkeyShort(publicKey)}.${bindingShort(binding)}`;

  return {
    id,
    name,
    pubkey: publicKey.toString("base64url"),
    privkey: privateKey.toString("base64url"),
    binding,
    bindingComponents,
    createdAt: Date.now(),
  };
}

export async function loadOrCreateInstanceIdentity(
  options: InstanceIDOptions = {},
): Promise<{ identity: InstanceIdentity; signMessage: (message: string) => string }> {
  const filePath = resolveInstanceIDPath(options.customPath);

  try {
    const raw = await readFile(filePath, "utf8");
    const persisted = JSON.parse(raw) as PersistedIdentity;

    // Validate that the stored identity still matches this environment
    const currentComponents = getBindingComponents();
    const currentBinding = computeBindingHash(currentComponents);

    if (persisted.binding !== currentBinding) {
      // Environment changed (e.g. migrated to new machine) — regenerate
      const fresh = generateInstanceIdentity(options);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(fresh, null, 2));
      return {
        identity: stripPrivateKey(fresh),
        signMessage: (msg) => signWithKey(Buffer.from(fresh.privkey, "base64url"), msg),
      };
    }

    return {
      identity: stripPrivateKey(persisted),
      signMessage: (msg) => signWithKey(Buffer.from(persisted.privkey, "base64url"), msg),
    };
  } catch {
    // File doesn't exist or is corrupt — create new identity
    const fresh = generateInstanceIdentity(options);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(fresh, null, 2));
    return {
      identity: stripPrivateKey(fresh),
      signMessage: (msg) => signWithKey(Buffer.from(fresh.privkey, "base64url"), msg),
    };
  }
}

function stripPrivateKey(persisted: PersistedIdentity): InstanceIdentity {
  const { privkey: _, ...identity } = persisted;
  return identity;
}

function signWithKey(privateKey: Buffer, message: string): string {
  const sig = sign(null, Buffer.from(message, "utf8"), {
    key: privateKey,
    format: "der",
    type: "pkcs8",
  });
  return sig.toString("base64url");
}

export function verifyInstanceSignature(
  identity: InstanceIdentity,
  message: string,
  signature: string,
): boolean {
  try {
    const pubkeyBuffer = Buffer.from(identity.pubkey, "base64url");
    return verify(
      null,
      Buffer.from(message, "utf8"),
      { key: pubkeyBuffer, format: "der", type: "spki" },
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function verifyInstanceIDBinding(
  identity: InstanceIdentity,
): { valid: boolean; currentBinding: string; mismatch?: string } {
  const currentComponents = getBindingComponents();
  const currentBinding = computeBindingHash(currentComponents);

  if (identity.binding !== currentBinding) {
    return {
      valid: false,
      currentBinding,
      mismatch: `Stored binding ${identity.binding.slice(0, 8)} does not match current environment ${currentBinding.slice(0, 8)}`,
    };
  }

  return { valid: true, currentBinding };
}

export function formatInstanceIDForDisplay(identity: InstanceIdentity): string {
  const { bindingComponents, createdAt } = identity;
  const date = new Date(createdAt).toLocaleString();
  return [
    `Instance ID: ${identity.id}`,
    `Name:        ${identity.name}`,
    `Pubkey:      ${identity.pubkey.slice(0, 24)}...`,
    `Binding:     ${identity.binding.slice(0, 16)}...`,
    `Bound to:    ${bindingComponents.username}@${bindingComponents.hostname} (${bindingComponents.platform})`,
    `Created:     ${date}`,
  ].join("\n");
}
