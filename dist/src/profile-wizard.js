import { SetupCancelledError } from "./setup-wizard.js";
import { mergeUserPublicAttributes, normalizeAttributeKey, normalizeUserPublicAttribute, } from "./user-attributes.js";
const CANCELLED_MESSAGE = "Profile update cancelled. No changes were written.";
const SAVED_MESSAGE = "Profile attributes saved.\n\nRestart the gateway to broadcast updated attributes.";
export async function runProfileWizard(options) {
    try {
        const readOnlyTags = options.readOnlyTags
            .map((attribute) => normalizeUserPublicAttribute(attribute))
            .filter((attribute) => attribute?.kind === "tag");
        let attributes = normalizeProfileAttributes(options.profileAttributes);
        options.prompter.print(formatProfileOverview(readOnlyTags, attributes));
        while (true) {
            const action = await options.prompter.select("What do you want to do?", [
                { label: "Add structured attribute", value: "add-attribute" },
                { label: "Edit structured attribute", value: "edit-attribute" },
                { label: "Remove structured attribute", value: "remove-attribute" },
                { label: "Preview and finish", value: "preview-finish" },
                { label: "Cancel", value: "cancel" },
            ]);
            switch (action) {
                case "add-attribute":
                    attributes = mergeUserPublicAttributes([], [...attributes, await promptForAttribute(options.prompter)]);
                    options.prompter.print(formatProfileOverview(readOnlyTags, attributes));
                    break;
                case "edit-attribute":
                    attributes = await promptForAttributeEdit(options.prompter, attributes);
                    options.prompter.print(formatProfileOverview(readOnlyTags, attributes));
                    break;
                case "remove-attribute":
                    attributes = await promptForAttributeRemoval(options.prompter, attributes);
                    options.prompter.print(formatProfileOverview(readOnlyTags, attributes));
                    break;
                case "preview-finish":
                    options.prompter.print(formatProfilePreview(readOnlyTags, attributes));
                    if (!(await options.prompter.confirm("Save profile attributes?", true))) {
                        return cancelledResult();
                    }
                    await options.writer.replaceAttributes(attributes);
                    return {
                        status: "saved",
                        attributes,
                        message: SAVED_MESSAGE,
                    };
                case "cancel":
                    return cancelledResult();
            }
        }
    }
    catch (error) {
        if (error instanceof SetupCancelledError) {
            return cancelledResult();
        }
        throw error;
    }
}
function normalizeProfileAttributes(attributes) {
    return mergeUserPublicAttributes([], attributes).filter((attribute) => attribute.kind === "structured");
}
async function promptForAttribute(prompter) {
    const category = await prompter.select("Attribute category", [
        { label: "Group", value: "group" },
        { label: "Project", value: "project" },
        { label: "Role", value: "role" },
        { label: "Skill", value: "skill" },
        { label: "Custom key", value: "custom" },
    ]);
    const key = category === "custom"
        ? normalizeAttributeKey(await prompter.input("Custom key", { required: true }))
        : category;
    const value = await prompter.input("Attribute value", { required: true });
    return {
        kind: "structured",
        key,
        value: value.trim(),
        label: `${key}: ${value.trim()}`,
        source: "profile",
    };
}
async function promptForAttributeEdit(prompter, attributes) {
    if (attributes.length === 0) {
        prompter.print("No structured profile attributes configured.");
        return attributes;
    }
    const selectedIndex = await selectAttributeIndex(prompter, "Attribute to edit", attributes);
    const nextAttribute = await promptForAttribute(prompter);
    return mergeUserPublicAttributes([], attributes.map((attribute, index) => (index === selectedIndex ? nextAttribute : attribute))).filter((attribute) => attribute.kind === "structured");
}
async function promptForAttributeRemoval(prompter, attributes) {
    if (attributes.length === 0) {
        prompter.print("No structured profile attributes configured.");
        return attributes;
    }
    const selectedIndex = await selectAttributeIndex(prompter, "Attribute to remove", attributes);
    return attributes.filter((_attribute, index) => index !== selectedIndex);
}
async function selectAttributeIndex(prompter, message, attributes) {
    const selectedKey = await prompter.select(message, attributes.map((attribute, index) => ({
        label: formatAttribute(attribute),
        value: `attribute-index-${index}`,
    })));
    const match = /^attribute-index-(\d+)$/.exec(selectedKey);
    return match ? Number(match[1]) : -1;
}
function formatProfileOverview(readOnlyTags, attributes) {
    return [
        "Read-only USER.md tags:",
        ...formatAttributeList(readOnlyTags),
        "",
        "Structured profile attributes:",
        ...formatAttributeList(attributes),
    ].join("\n");
}
function formatProfilePreview(readOnlyTags, attributes) {
    return [
        "Preview: public attributes",
        "",
        "Read-only USER.md tags:",
        ...formatAttributeList(readOnlyTags),
        "",
        "Structured profile attributes to save:",
        ...formatAttributeList(attributes),
    ].join("\n");
}
function formatAttributeList(attributes) {
    if (attributes.length === 0) {
        return ["  none"];
    }
    return attributes.map((attribute, index) => `  ${index + 1}. ${formatAttribute(attribute)}`);
}
function formatAttribute(attribute) {
    if (attribute.kind === "tag") {
        return `${attribute.label} (USER.md tag, read-only)`;
    }
    return `${attribute.key}: ${attribute.value}`;
}
function cancelledResult() {
    return {
        status: "cancelled",
        message: CANCELLED_MESSAGE,
    };
}
//# sourceMappingURL=profile-wizard.js.map