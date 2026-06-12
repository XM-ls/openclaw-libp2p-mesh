import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface InstanceAnnouncePayload {
  instanceId: string;
  peerId: string;
  instanceName?: string;
  pubkey?: string;
  multiaddrs?: string[];
  announcedAt: number;
}

export interface InstancePeerRecord {
  instanceId: string;
  peerId: string;
  instanceName?: string;
  pubkey?: string;
  multiaddrs: string[];
  lastAnnouncedAt: number;
  lastSeenAt: number;
  source: "announce";
}

export interface InstancePeerTable {
  version: 1;
  updatedAt: number;
  instances: Record<string, InstancePeerRecord>;
}

export interface InstancePeerStore {
  load(): Promise<InstancePeerTable>;
  save(table: InstancePeerTable): Promise<InstancePeerTable>;
  list(): Promise<InstancePeerRecord[]>;
  resolve(instanceId: string): Promise<InstancePeerRecord | undefined>;
  upsertFromAnnounce(payload: InstanceAnnouncePayload): Promise<{
    record: InstancePeerRecord;
    changed: boolean;
    peerIdSharedBy: string[];
  }>;
}

export interface StoreLogger {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
}

const noopLogger: StoreLogger = {
  info: () => {},
  debug: () => {},
  warn: () => {},
};

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

function sameRecord(
  record: InstancePeerRecord | undefined,
  payload: InstanceAnnouncePayload,
): boolean {
  if (!record) return false;

  return (
    record.peerId === payload.peerId &&
    record.instanceName === payload.instanceName &&
    record.pubkey === payload.pubkey &&
    sameStringArray(record.multiaddrs, payload.multiaddrs ?? []) &&
    record.lastAnnouncedAt === payload.announcedAt
  );
}

export function createInstancePeerStore(options: {
  path?: string;
  logger?: StoreLogger;
} = {}): InstancePeerStore {
  const filePath = resolveInstancePeerPath(options.path);
  const logger = options.logger ?? noopLogger;
  let cache: InstancePeerTable | undefined;

  async function load(): Promise<InstancePeerTable> {
    if (cache) return cache;

    try {
      const raw = await readFile(filePath, "utf8");
      cache = JSON.parse(raw) as InstancePeerTable;
      return cache;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        cache = emptyTable();
        return cache;
      }

      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await rename(filePath, backupPath);
        logger.warn(`Instance peer store unreadable; moved to ${backupPath}`);
      } catch (renameError) {
        logger.warn(
          `Instance peer store unreadable; failed to move corrupt file to ${backupPath}: ${
            (renameError as Error).message
          }`,
        );
      }

      cache = emptyTable();
      return cache;
    }
  }

  async function save(table: InstancePeerTable): Promise<InstancePeerTable> {
    const next: InstancePeerTable = {
      ...table,
      version: 1,
      updatedAt: Date.now(),
      instances: { ...table.instances },
    };
    const dir = path.dirname(filePath);
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

    await mkdir(dir, { recursive: true });
    await writeFile(tmpPath, JSON.stringify(next, null, 2), "utf8");
    await rename(tmpPath, filePath);
    cache = next;
    logger.debug(`Saved instance peer store to ${filePath}`);
    return next;
  }

  return {
    load,
    save,
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
      const table = await load();
      const existing = table.instances[payload.instanceId];
      const changed = !sameRecord(existing, payload);
      const record: InstancePeerRecord = {
        instanceId: payload.instanceId,
        peerId: payload.peerId,
        instanceName: payload.instanceName,
        pubkey: payload.pubkey,
        multiaddrs: payload.multiaddrs ?? [],
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
        logger.warn(
          `Peer ID ${payload.peerId} is shared by instances: ${peerIdSharedBy.join(", ")}`,
        );
      }

      await save(nextTable);
      return { record, changed, peerIdSharedBy };
    },
  };
}
