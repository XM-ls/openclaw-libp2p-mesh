import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { normalizeAttributeKey, normalizeAttributeValue, } from "./user-attributes.js";
export function resolvePeerLabelsPath(customPath) {
    if (customPath)
        return customPath;
    const stateDir = process.env.OPENCLAW_STATE_DIR;
    if (stateDir) {
        return path.join(stateDir, "libp2p", "peer-labels.json");
    }
    return path.join(homedir(), ".openclaw", "libp2p", "peer-labels.json");
}
function emptyLabelsFile() {
    return {
        version: 1,
        updatedAt: Date.now(),
        peers: {},
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function trimmedString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function getLocalPeerLabelId(label) {
    return `${normalizeAttributeKey(label.key)}:${normalizeAttributeValue(label.value)}`;
}
function normalizePeerLabel(value) {
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
function normalizePeerLabels(labels) {
    if (!Array.isArray(labels)) {
        return [];
    }
    const normalized = [];
    const seen = new Set();
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
function normalizePeerLabelsFile(value) {
    const candidate = isRecord(value) ? value : {};
    const peers = {};
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
export function createPeerLabelStore(options) {
    const filePath = resolvePeerLabelsPath(options?.path);
    const logger = options?.logger;
    let cached;
    let mutationQueue = Promise.resolve();
    async function load() {
        try {
            const raw = await readFile(filePath, "utf8");
            cached = normalizePeerLabelsFile(JSON.parse(raw));
            return cached;
        }
        catch (error) {
            const code = error.code;
            if (code === "ENOENT") {
                cached = emptyLabelsFile();
                return cached;
            }
            const backupPath = `${filePath}.corrupt-${Date.now()}`;
            try {
                await mkdir(path.dirname(filePath), { recursive: true });
                await rename(filePath, backupPath);
                logger?.warn?.(`[libp2p-mesh] Peer label store unreadable; moved to ${backupPath}`);
            }
            catch (renameError) {
                logger?.warn?.(`[libp2p-mesh] Peer label store unreadable; failed to move corrupt file to ${backupPath}: ${renameError.message}`);
            }
            cached = emptyLabelsFile();
            return cached;
        }
    }
    async function save(file) {
        const nextFile = {
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
    async function runMutation(fn) {
        const next = mutationQueue.then(fn, fn);
        mutationQueue = next.then(() => undefined, () => undefined);
        return next;
    }
    async function listRawLabels(instanceId) {
        const file = await load();
        return [...(file.peers[instanceId]?.labels ?? [])];
    }
    return {
        load,
        save,
        listRawLabels,
        async listLabels(instanceId) {
            const labels = await listRawLabels(instanceId);
            return labels.map((label) => ({
                kind: "structured",
                key: label.key,
                value: label.value,
                label: label.value,
                source: "local",
            }));
        },
        async replaceLabels(instanceId, labels) {
            return runMutation(async () => {
                const file = await load();
                const peers = { ...file.peers };
                const normalizedLabels = normalizePeerLabels(labels);
                if (normalizedLabels.length === 0) {
                    delete peers[instanceId];
                }
                else {
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
//# sourceMappingURL=peer-label-store.js.map