import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { UserPublicAttribute } from "./types.js";
import {
  normalizeAttributeKey,
  normalizeAttributeValue,
} from "./user-attributes.js";

export type UserProfile = {
  version: 1;
  updatedAt: number;
  attributes: UserPublicAttribute[];
};

export type UserProfileLogger = {
  debug?: (message: string) => void;
  warn?: (message: string) => void;
};

export type UserProfileAttributeTarget = string | number;

export type UserProfileStore = {
  load(): Promise<UserProfile>;
  save(profile: UserProfile): Promise<UserProfile>;
  listAttributes(): Promise<UserPublicAttribute[]>;
  replaceAttributes(attributes: UserPublicAttribute[]): Promise<UserProfile>;
  updateAttribute(
    target: UserProfileAttributeTarget,
    attribute: UserPublicAttribute,
  ): Promise<UserProfile>;
  removeAttribute(target: UserProfileAttributeTarget): Promise<UserProfile>;
};

export function resolveUserProfilePath(customPath?: string): string {
  if (customPath) return customPath;

  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    return path.join(stateDir, "libp2p", "user-profile.json");
  }

  return path.join(homedir(), ".openclaw", "libp2p", "user-profile.json");
}

export function getUserProfileAttributeId(attribute: UserPublicAttribute): string {
  if (attribute.kind !== "structured") {
    return "";
  }

  return `structured:${normalizeAttributeKey(attribute.key)}:${normalizeAttributeValue(attribute.value)}`;
}

function emptyProfile(): UserProfile {
  return {
    version: 1,
    updatedAt: Date.now(),
    attributes: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeProfileAttribute(value: unknown): UserPublicAttribute | undefined {
  if (!isRecord(value) || value.kind !== "structured") {
    return undefined;
  }

  if (value.source !== undefined && value.source !== "profile") {
    return undefined;
  }

  const key = trimmedString(value.key);
  const attributeValue = trimmedString(value.value);
  const label = trimmedString(value.label);
  if (!key || !attributeValue || !label) {
    return undefined;
  }

  return {
    kind: "structured",
    key: normalizeAttributeKey(key),
    value: attributeValue,
    label,
    source: "profile",
  };
}

function normalizeProfileAttributes(attributes: unknown): UserPublicAttribute[] {
  if (!Array.isArray(attributes)) {
    return [];
  }

  const normalized: UserPublicAttribute[] = [];
  const seen = new Set<string>();

  for (const value of attributes) {
    const attribute = normalizeProfileAttribute(value);
    if (!attribute) {
      continue;
    }

    const id = getUserProfileAttributeId(attribute);
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push(attribute);
  }

  return normalized;
}

function normalizeProfile(value: unknown): UserProfile {
  const candidate = isRecord(value) ? value : {};

  return {
    version: 1,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
    attributes: normalizeProfileAttributes(candidate.attributes),
  };
}

function resolveTargetIndex(attributes: UserPublicAttribute[], target: UserProfileAttributeTarget): number {
  if (typeof target === "number") {
    return Number.isInteger(target) && target >= 0 && target < attributes.length ? target : -1;
  }

  return attributes.findIndex((attribute) => getUserProfileAttributeId(attribute) === target);
}

export function createUserProfileStore(options?: {
  path?: string;
  logger?: UserProfileLogger;
}): UserProfileStore {
  const filePath = resolveUserProfilePath(options?.path);
  const logger = options?.logger;
  let cached: UserProfile | undefined;
  let mutationQueue = Promise.resolve();

  async function load(): Promise<UserProfile> {
    try {
      const raw = await readFile(filePath, "utf8");
      cached = normalizeProfile(JSON.parse(raw));
      return cached;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        cached = emptyProfile();
        return cached;
      }

      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await rename(filePath, backupPath);
        logger?.warn?.(`[libp2p-mesh] User profile store unreadable; moved to ${backupPath}`);
      } catch (renameError) {
        logger?.warn?.(
          `[libp2p-mesh] User profile store unreadable; failed to move corrupt file to ${backupPath}: ${
            (renameError as Error).message
          }`,
        );
      }

      cached = emptyProfile();
      return cached;
    }
  }

  async function save(profile: UserProfile): Promise<UserProfile> {
    const nextProfile: UserProfile = {
      version: 1,
      updatedAt: Date.now(),
      attributes: normalizeProfileAttributes(profile.attributes),
    };
    const dir = path.dirname(filePath);
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

    await mkdir(dir, { recursive: true });
    await writeFile(tmpPath, `${JSON.stringify(nextProfile, null, 2)}\n`, "utf8");
    await rename(tmpPath, filePath);
    cached = nextProfile;
    logger?.debug?.(`[libp2p-mesh] Saved user profile store to ${filePath}`);
    return nextProfile;
  }

  async function runMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = mutationQueue.then(fn, fn);
    mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    load,
    save,
    async listAttributes(): Promise<UserPublicAttribute[]> {
      const profile = cached ?? (await load());
      return [...profile.attributes];
    },
    async replaceAttributes(attributes: UserPublicAttribute[]): Promise<UserProfile> {
      return runMutation(async () => {
        const profile = await load();
        return save({
          ...profile,
          attributes,
        });
      });
    },
    async updateAttribute(
      target: UserProfileAttributeTarget,
      attribute: UserPublicAttribute,
    ): Promise<UserProfile> {
      return runMutation(async () => {
        const profile = await load();
        const index = resolveTargetIndex(profile.attributes, target);
        if (index < 0) {
          throw new RangeError(`User profile attribute not found: ${String(target)}`);
        }

        const attributes = [...profile.attributes];
        attributes[index] = attribute;
        return save({
          ...profile,
          attributes,
        });
      });
    },
    async removeAttribute(target: UserProfileAttributeTarget): Promise<UserProfile> {
      return runMutation(async () => {
        const profile = await load();
        const index = resolveTargetIndex(profile.attributes, target);
        if (index < 0) {
          throw new RangeError(`User profile attribute not found: ${String(target)}`);
        }

        return save({
          ...profile,
          attributes: profile.attributes.filter((_, attributeIndex) => attributeIndex !== index),
        });
      });
    },
  };
}
