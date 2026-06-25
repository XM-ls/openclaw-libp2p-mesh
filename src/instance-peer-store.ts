import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  InstanceAnnouncePayload,
  InstancePeerRecord,
  InstancePeerStore,
  InstancePeerTable,
  LocalPeerLabelAttribute,
  UserPublicAttribute,
} from "./types.js";
import {
  normalizeAttributeKey,
  normalizeAttributeValue,
  normalizeUserPublicAttribute,
} from "./user-attributes.js";

export interface StoreLogger {
  info?(message: string): void;
  debug?(message: string): void;
  warn?(message: string): void;
}

export function resolveInstancePeerPath(customPath?: string): string {
  if (customPath) return customPath;

  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    return path.join(stateDir, "libp2p", "instance-peer.json");
  }

  return path.join(homedir(), ".openclaw", "libp2p", "instance-peer.json");
}

function emptyTable(): InstancePeerTable {
  return {
    version: 1,
    updatedAt: Date.now(),
    instances: {},
  };
}

function sameStringArray(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function normalizeUserPublicAttributes(value: unknown): UserPublicAttribute[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((attribute) => normalizeUserPublicAttribute(attribute))
    .filter((attribute): attribute is UserPublicAttribute => attribute !== undefined);
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

function localLabelDedupeKey(label: LocalPeerLabelAttribute): string {
  return `${normalizeAttributeKey(label.key)}:${normalizeAttributeValue(label.value)}`;
}

function normalizeLocalLabel(value: unknown): LocalPeerLabelAttribute | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.kind !== "structured" || value.source !== "local") {
    return undefined;
  }

  const key = trimmedString(value.key);
  const labelValue = trimmedString(value.value);
  const label = trimmedString(value.label);
  if (!key || !labelValue || !label) {
    return undefined;
  }

  return {
    kind: "structured",
    key: normalizeAttributeKey(key),
    value: labelValue,
    label,
    source: "local",
  };
}

function normalizeLocalLabels(value: unknown): LocalPeerLabelAttribute[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: LocalPeerLabelAttribute[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    const label = normalizeLocalLabel(entry);
    if (!label) {
      continue;
    }

    const id = localLabelDedupeKey(label);
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push(label);
  }

  return normalized;
}

function withLocalLabels(
  record: InstancePeerRecord,
  labels: LocalPeerLabelAttribute[],
): InstancePeerRecord {
  const normalizedLabels = normalizeLocalLabels(labels);
  if (normalizedLabels.length === 0) {
    const { localLabels: _localLabels, ...withoutLocalLabels } = record;
    return withoutLocalLabels;
  }

  return {
    ...record,
    localLabels: normalizedLabels,
  };
}

function sameUserPublicAttributes(a: UserPublicAttribute[] = [], b: UserPublicAttribute[] = []): boolean {
  if (a.length !== b.length) return false;
  return a.every((attribute, index) => {
    const other = b[index];
    return JSON.stringify(attribute) === JSON.stringify(other);
  });
}

function sameRecord(
  record: InstancePeerRecord | undefined,
  payload: InstanceAnnouncePayload,
): boolean {
  if (!record) return false;

  const recordAttributes = normalizeUserPublicAttributes(record.userPublicAttributes);
  const payloadAttributes = normalizeUserPublicAttributes(payload.userPublicAttributes);
  const payloadIncludesAttributes = "userPublicAttributes" in payload;

  return (
    record.peerId === payload.peerId &&
    record.instanceName === payload.instanceName &&
    record.pubkey === payload.pubkey &&
    sameStringArray(record.multiaddrs, payload.multiaddrs) &&
    (!payloadIncludesAttributes ||
      sameUserPublicAttributes(recordAttributes, payloadAttributes)) &&
    record.lastAnnouncedAt === payload.announcedAt
  );
}

function normalizeRecord(value: InstancePeerRecord): InstancePeerRecord {
  const record = {
    ...value,
    userPublicAttributes: normalizeUserPublicAttributes(value.userPublicAttributes),
  };

  return withLocalLabels(record, normalizeLocalLabels(value.localLabels));
}

function normalizeTable(value: unknown): InstancePeerTable {
  const candidate = value && typeof value === "object" ? value : {};
  const table = candidate as Partial<InstancePeerTable>;
  const instances =
    table.instances && typeof table.instances === "object" && !Array.isArray(table.instances)
      ? table.instances
      : {};

  const normalizedInstances: Record<string, InstancePeerRecord> = {};
  for (const [instanceId, record] of Object.entries(instances)) {
    if (record && typeof record === "object") {
      normalizedInstances[instanceId] = normalizeRecord(record as InstancePeerRecord);
    }
  }

  return {
    version: 1,
    updatedAt: typeof table.updatedAt === "number" ? table.updatedAt : Date.now(),
    instances: normalizedInstances,
  };
}

export function createInstancePeerStore(options?: {
  path?: string;
  logger?: StoreLogger;
}): InstancePeerStore {
  const filePath = resolveInstancePeerPath(options?.path);
  const logger = options?.logger;
  let cached: InstancePeerTable | undefined;
  let mutationQueue = Promise.resolve();

  async function load(): Promise<InstancePeerTable> {
    try {
      const raw = await readFile(filePath, "utf8");
      cached = normalizeTable(JSON.parse(raw));
      return cached;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        cached = emptyTable();
        return cached;
      }

      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await rename(filePath, backupPath);
        logger?.warn?.(`[libp2p-mesh] Instance peer store unreadable; moved to ${backupPath}`);
      } catch (renameError) {
        logger?.warn?.(
          `[libp2p-mesh] Instance peer store unreadable; failed to move corrupt file to ${backupPath}: ${
            (renameError as Error).message
          }`,
        );
      }

      cached = emptyTable();
      return cached;
    }
  }

  async function save(table: InstancePeerTable): Promise<InstancePeerTable> {
    table.updatedAt = Date.now();
    const dir = path.dirname(filePath);
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

    await mkdir(dir, { recursive: true });
    await writeFile(tmpPath, `${JSON.stringify(table, null, 2)}\n`, "utf8");
    await rename(tmpPath, filePath);
    cached = table;
    logger?.debug?.(`[libp2p-mesh] Saved instance peer store to ${filePath}`);
    return table;
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
    async list(): Promise<InstancePeerRecord[]> {
      const table = await load();
      return Object.values(table.instances).sort(
        (a, b) => b.lastSeenAt - a.lastSeenAt,
      );
    },
    async resolve(instanceId: string): Promise<InstancePeerRecord | undefined> {
      const table = await load();
      return table.instances[instanceId];
    },
    async upsertFromAnnounce(payload: InstanceAnnouncePayload): Promise<{
      record: InstancePeerRecord;
      changed: boolean;
      peerIdSharedBy: string[];
    }> {
      return runMutation(async () => {
        const table = await load();
        const existing = table.instances[payload.instanceId];
        const userPublicAttributes =
          "userPublicAttributes" in payload
            ? normalizeUserPublicAttributes(payload.userPublicAttributes)
            : normalizeUserPublicAttributes(existing?.userPublicAttributes);
        const localLabels = normalizeLocalLabels(existing?.localLabels);
        const changed = !sameRecord(existing, payload);
        const record: InstancePeerRecord = withLocalLabels({
          instanceId: payload.instanceId,
          peerId: payload.peerId,
          instanceName: payload.instanceName,
          pubkey: payload.pubkey,
          multiaddrs: payload.multiaddrs,
          userPublicAttributes,
          lastAnnouncedAt: payload.announcedAt,
          lastSeenAt: Date.now(),
          source: "announce",
        }, localLabels);

        const nextTable: InstancePeerTable = {
          ...table,
          instances: {
            ...table.instances,
            [payload.instanceId]: record,
          },
        };
        const peerIdSharedBy = Object.values(nextTable.instances)
          .filter((entry) => entry.peerId === payload.peerId)
          .map((entry) => entry.instanceId);

        if (peerIdSharedBy.length > 1) {
          logger?.warn?.(
            `[libp2p-mesh] Peer ID ${payload.peerId} is shared by instances: ${peerIdSharedBy.join(", ")}`,
          );
        }

        await save(nextTable);
        return { record, changed, peerIdSharedBy };
      });
    },
    async syncLocalLabels(
      labelsByInstance: Record<string, LocalPeerLabelAttribute[]>,
    ): Promise<InstancePeerTable> {
      return runMutation(async () => {
        const table = await load();
        const instances: Record<string, InstancePeerRecord> = {};

        for (const [instanceId, record] of Object.entries(table.instances)) {
          instances[instanceId] = withLocalLabels(
            record,
            labelsByInstance[instanceId] ?? [],
          );
        }

        return save({
          ...table,
          instances,
        });
      });
    },
    async updateLocalLabels(
      instanceId: string,
      labels: LocalPeerLabelAttribute[],
    ): Promise<InstancePeerRecord | undefined> {
      return runMutation(async () => {
        const table = await load();
        const existing = table.instances[instanceId];
        if (!existing) {
          return undefined;
        }

        const record = withLocalLabels(existing, labels);
        await save({
          ...table,
          instances: {
            ...table.instances,
            [instanceId]: record,
          },
        });

        return record;
      });
    },
  };
}
