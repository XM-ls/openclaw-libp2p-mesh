import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  LocalPeerLabel,
  LocalPeerLabelAttribute,
  PeerLabelsFile,
  PeerLabelStore,
} from "./types.js";
import {
  normalizeAttributeKey,
  normalizeAttributeValue,
} from "./user-attributes.js";

type PeerLabelStoreLogger = {
  debug?: (message: string) => void;
  warn?: (message: string) => void;
};

export function resolvePeerLabelsPath(customPath?: string): string {
  if (customPath) return customPath;

  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    return path.join(stateDir, "libp2p", "peer-labels.json");
  }

  return path.join(homedir(), ".openclaw", "libp2p", "peer-labels.json");
}

function emptyLabelsFile(): PeerLabelsFile {
  return {
    version: 1,
    updatedAt: Date.now(),
    peers: {},
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

function getLocalPeerLabelId(label: LocalPeerLabel): string {
  return `${normalizeAttributeKey(label.key)}:${normalizeAttributeValue(label.value)}`;
}

function normalizePeerLabel(value: unknown): LocalPeerLabel | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const key = trimmedString(value.key);
  const labelValue = trimmedString(value.value);
  if (!key || !labelValue) {
    return undefined;
  }

  return {
    key: normalizeAttributeKey(key),
    value: labelValue,
  };
}

function normalizePeerLabels(labels: unknown): LocalPeerLabel[] {
  if (!Array.isArray(labels)) {
    return [];
  }

  const normalized: LocalPeerLabel[] = [];
  const seen = new Set<string>();

  for (const value of labels) {
    const label = normalizePeerLabel(value);
    if (!label) {
      continue;
    }

    const id = getLocalPeerLabelId(label);
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push(label);
  }

  return normalized;
}

function normalizePeerLabelsFile(value: unknown): PeerLabelsFile {
  const candidate = isRecord(value) ? value : {};
  const peers: PeerLabelsFile["peers"] = {};
  const candidatePeers = isRecord(candidate.peers) ? candidate.peers : {};

  for (const [instanceId, peerValue] of Object.entries(candidatePeers)) {
    const peer = isRecord(peerValue) ? peerValue : {};
    const labels = normalizePeerLabels(peer.labels);
    if (labels.length === 0) {
      continue;
    }

    peers[instanceId] = { labels };
  }

  return {
    version: 1,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
    peers,
  };
}

export function createPeerLabelStore(options?: {
  path?: string;
  logger?: PeerLabelStoreLogger;
}): PeerLabelStore {
  const filePath = resolvePeerLabelsPath(options?.path);
  const logger = options?.logger;
  let cached: PeerLabelsFile | undefined;
  let mutationQueue = Promise.resolve();

  async function load(): Promise<PeerLabelsFile> {
    try {
      const raw = await readFile(filePath, "utf8");
      cached = normalizePeerLabelsFile(JSON.parse(raw));
      return cached;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        cached = emptyLabelsFile();
        return cached;
      }

      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await rename(filePath, backupPath);
        logger?.warn?.(`[libp2p-mesh] Peer label store unreadable; moved to ${backupPath}`);
      } catch (renameError) {
        logger?.warn?.(
          `[libp2p-mesh] Peer label store unreadable; failed to move corrupt file to ${backupPath}: ${
            (renameError as Error).message
          }`,
        );
      }

      cached = emptyLabelsFile();
      return cached;
    }
  }

  async function save(file: PeerLabelsFile): Promise<PeerLabelsFile> {
    const nextFile: PeerLabelsFile = {
      version: 1,
      updatedAt: Date.now(),
      peers: normalizePeerLabelsFile(file).peers,
    };
    const dir = path.dirname(filePath);
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

    await mkdir(dir, { recursive: true });
    await writeFile(tmpPath, `${JSON.stringify(nextFile, null, 2)}\n`, "utf8");
    await rename(tmpPath, filePath);
    cached = nextFile;
    logger?.debug?.(`[libp2p-mesh] Saved peer label store to ${filePath}`);
    return nextFile;
  }

  async function runMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = mutationQueue.then(fn, fn);
    mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function listRawLabels(instanceId: string): Promise<LocalPeerLabel[]> {
    const file = cached ?? (await load());
    return [...(file.peers[instanceId]?.labels ?? [])];
  }

  return {
    load,
    save,
    listRawLabels,
    async listLabels(instanceId: string): Promise<LocalPeerLabelAttribute[]> {
      const labels = await listRawLabels(instanceId);
      return labels.map((label) => ({
        kind: "structured",
        key: label.key,
        value: label.value,
        label: label.value,
        source: "local",
      }));
    },
    async replaceLabels(instanceId: string, labels: LocalPeerLabel[]): Promise<PeerLabelsFile> {
      return runMutation(async () => {
        const file = await load();
        const peers = { ...file.peers };
        const normalizedLabels = normalizePeerLabels(labels);

        if (normalizedLabels.length === 0) {
          delete peers[instanceId];
        } else {
          peers[instanceId] = { labels: normalizedLabels };
        }

        return save({
          ...file,
          peers,
        });
      });
    },
  };
}
