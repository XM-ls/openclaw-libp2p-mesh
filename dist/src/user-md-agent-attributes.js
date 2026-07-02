import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { normalizeAttributeValue } from "./user-attributes.js";
import { resolveUserMdPath } from "./user-md-attributes.js";
const CACHE_VERSION = 1;
const MAX_AGENT_TAGS = 10;
const MAX_AGENT_TAG_LENGTH = 40;
const defaultExtractor = {
    async extract() {
        return {
            unavailable: true,
            reason: "USER.md agent extraction is unavailable in this runtime",
        };
    },
};
export function resolveUserMdAttributeCachePath(customPath) {
    if (customPath) {
        return customPath;
    }
    const stateDir = process.env.OPENCLAW_STATE_DIR;
    if (stateDir) {
        return path.join(stateDir, "libp2p", "user-md-attributes-cache.json");
    }
    return path.join(homedir(), ".openclaw", "libp2p", "user-md-attributes-cache.json");
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function normalizeWhitespace(value) {
    return value.trim().replace(/\s+/g, " ");
}
function looksLikeSentence(value) {
    return /[。.!?！？]/.test(value) || value.split(/\s+/).filter(Boolean).length > 4;
}
function normalizeAgentTag(value) {
    if (!isRecord(value) || value.kind !== "tag" || value.source !== "USER.md") {
        return undefined;
    }
    if (typeof value.value !== "string" || typeof value.label !== "string") {
        return undefined;
    }
    const tagValue = normalizeWhitespace(value.value);
    const label = normalizeWhitespace(value.label);
    if (!tagValue || !label || tagValue.length > MAX_AGENT_TAG_LENGTH || looksLikeSentence(tagValue)) {
        return undefined;
    }
    return {
        kind: "tag",
        value: tagValue,
        label,
        source: "USER.md",
    };
}
export function validateExtractedUserMdTags(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const attributes = [];
    const seen = new Set();
    for (const rawAttribute of value) {
        const attribute = normalizeAgentTag(rawAttribute);
        if (!attribute) {
            continue;
        }
        const key = normalizeAttributeValue(attribute.value);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        attributes.push(attribute);
        if (attributes.length >= MAX_AGENT_TAGS) {
            break;
        }
    }
    return attributes;
}
function hashMarkdown(markdown) {
    return createHash("sha256").update(markdown, "utf8").digest("hex");
}
function normalizeCacheFile(value) {
    if (!isRecord(value) || value.version !== CACHE_VERSION || typeof value.userMdHash !== "string") {
        return undefined;
    }
    const attributes = validateExtractedUserMdTags(value.attributes);
    if (!Array.isArray(value.attributes) || attributes.length !== value.attributes.length) {
        return undefined;
    }
    return {
        version: CACHE_VERSION,
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
        userMdHash: value.userMdHash,
        attributes,
    };
}
async function readCache(cachePath) {
    try {
        return normalizeCacheFile(JSON.parse(await readFile(cachePath, "utf8")));
    }
    catch {
        return undefined;
    }
}
async function writeCache(cachePath, userMdHash, attributes) {
    const cache = {
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        userMdHash,
        attributes: validateExtractedUserMdTags(attributes),
    };
    const dir = path.dirname(cachePath);
    const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    await mkdir(dir, { recursive: true });
    try {
        await writeFile(tmpPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
        await rename(tmpPath, cachePath);
    }
    catch (error) {
        await rm(tmpPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
function isExtractionUnavailable(value) {
    return isRecord(value) && value.unavailable === true && typeof value.reason === "string";
}
export function createUserMdAgentAttributeSource(options) {
    const filePath = resolveUserMdPath(options?.path);
    const cachePath = resolveUserMdAttributeCachePath(options?.cachePath);
    const extractor = options?.extractor ?? defaultExtractor;
    const logger = options?.logger;
    async function readUserMd() {
        try {
            const markdown = await readFile(filePath, "utf8");
            return { markdown, userMdHash: hashMarkdown(markdown) };
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return undefined;
            }
            logger?.warn?.(`[libp2p-mesh] Failed to read USER.md at ${filePath}: ${error.message}`);
            return undefined;
        }
    }
    async function loadCachedTagsForCurrentHash() {
        const userMd = await readUserMd();
        if (!userMd) {
            return [];
        }
        const cache = await readCache(cachePath);
        return cache?.userMdHash === userMd.userMdHash ? [...cache.attributes] : [];
    }
    return {
        async loadTags() {
            return loadCachedTagsForCurrentHash();
        },
        async refreshTags() {
            const userMd = await readUserMd();
            if (!userMd) {
                return [];
            }
            const cache = await readCache(cachePath);
            if (cache?.userMdHash === userMd.userMdHash) {
                return [...cache.attributes];
            }
            const extracted = await extractor.extract({
                markdown: userMd.markdown,
                sourcePath: filePath,
            });
            if (isExtractionUnavailable(extracted)) {
                logger?.warn?.(`[libp2p-mesh] USER.md agent extraction unavailable: ${extracted.reason}`);
                return [];
            }
            const attributes = validateExtractedUserMdTags(extracted);
            await writeCache(cachePath, userMd.userMdHash, attributes);
            logger?.debug?.(`[libp2p-mesh] Saved USER.md agent attribute cache to ${cachePath}`);
            return attributes;
        },
    };
}
//# sourceMappingURL=user-md-agent-attributes.js.map