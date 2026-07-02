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
export function normalizeAttributeValue(value) {
    return value.trim().toLowerCase();
}
export function normalizeAttributeKey(key) {
    return key.trim().toLowerCase();
}
export function normalizeUserPublicAttribute(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    if (value.kind === "tag") {
        if (value.source !== "USER.md") {
            return undefined;
        }
        const attributeValue = trimmedString(value.value);
        const label = trimmedString(value.label);
        if (!attributeValue || !label) {
            return undefined;
        }
        return {
            kind: "tag",
            value: attributeValue,
            label,
            source: "USER.md",
        };
    }
    if (value.kind === "structured") {
        if (value.source !== "profile") {
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
    return undefined;
}
function attributeDedupeKey(attribute) {
    if (attribute.kind === "tag") {
        return `tag:${normalizeAttributeValue(attribute.value)}`;
    }
    return `structured:${normalizeAttributeKey(attribute.key)}:${normalizeAttributeValue(attribute.value)}`;
}
export function mergeUserPublicAttributes(userMdTags, profileAttributes) {
    const merged = [];
    const seen = new Set();
    for (const rawAttribute of [...userMdTags, ...profileAttributes]) {
        const attribute = normalizeUserPublicAttribute(rawAttribute);
        if (!attribute) {
            continue;
        }
        const key = attributeDedupeKey(attribute);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        merged.push(attribute);
    }
    return merged;
}
export function matchesUserAttribute(attribute, match) {
    if (attribute.kind !== match.kind) {
        return false;
    }
    if (attribute.kind === "tag") {
        return normalizeAttributeValue(attribute.value) === normalizeAttributeValue(match.value);
    }
    if (match.kind !== "structured") {
        return false;
    }
    return (normalizeAttributeKey(attribute.key) === normalizeAttributeKey(match.key) &&
        normalizeAttributeValue(attribute.value) === normalizeAttributeValue(match.value));
}
//# sourceMappingURL=user-attributes.js.map