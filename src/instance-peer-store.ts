import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  InstanceAnnouncePayload,
  InstancePeerRecord,
  InstancePeerStore,
  InstancePeerTable,
  UserPublicAttribute,
} from "./types.js";
import { normalizeUserPublicAttribute } from "./user-attributes.js";

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

  return (
    record.peerId === payload.peerId &&
    record.instanceName === payload.instanceName &&
    record.pubkey === payload.pubkey &&
    sameStringArray(record.multiaddrs, payload.multiaddrs) &&
    sameUserPublicAttributes(recordAttributes, payloadAttributes) &&
    record.lastAnnouncedAt === payload.announcedAt
  );
}

function normalizeRecord(value: InstancePeerRecord): InstancePeerRecord {
  return {
    ...value,
    userPublicAttributes: normalizeUserPublicAttributes(value.userPublicAttributes),
  };
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
        const userPublicAttributes = normalizeUserPublicAttributes(payload.userPublicAttributes);
        const changed = !sameRecord(existing, payload);
        const record: InstancePeerRecord = {
          instanceId: payload.instanceId,
          peerId: payload.peerId,
          instanceName: payload.instanceName,
          pubkey: payload.pubkey,
          multiaddrs: payload.multiaddrs,
          userPublicAttributes,
          lastAnnouncedAt: payload.announcedAt,
          lastSeenAt: Date.now(),
          source: "announce",
        };

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
  };
}
