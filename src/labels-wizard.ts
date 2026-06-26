import { SetupCancelledError, type SetupPrompter } from "./setup-wizard.js";
import type { InstancePeerRecord, LocalPeerLabel, UserPublicAttribute } from "./types.js";
import { normalizeAttributeKey } from "./user-attributes.js";

const CANCELLED_MESSAGE = "Local labels update cancelled. No changes were written.";
const SAVED_MESSAGE = "Local labels saved.";

export type PeerLabelsWriter = {
  replaceLabels(instanceId: string, labels: LocalPeerLabel[]): Promise<void>;
};

export type RunLabelsWizardOptions = {
  prompter: SetupPrompter;
  instances: InstancePeerRecord[];
  getLabels(instanceId: string): Promise<LocalPeerLabel[]>;
  writer: PeerLabelsWriter;
};

export type LabelsWizardResult =
  | { status: "saved"; instanceId: string; labels: LocalPeerLabel[]; message: string }
  | { status: "cancelled"; message: string };

type LabelsAction = "add-label" | "edit-label" | "remove-label" | "choose-instance" | "save-finish" | "cancel";

export async function runLabelsWizard(options: RunLabelsWizardOptions): Promise<LabelsWizardResult> {
  try {
    if (options.instances.length === 0) {
      options.prompter.print("No discovered instances found. Start the gateway and wait for peer announcements first.");
      return cancelledResult();
    }

    options.prompter.print(formatInstancesOverview(options.instances));
    let selectedInstance = options.instances[await selectInstanceIndex(options.prompter, options.instances)];
    let labels = normalizeLabels(await options.getLabels(selectedInstance.instanceId));
    options.prompter.print(formatLabelsOverview(selectedInstance, labels));

    while (true) {
      const action = await options.prompter.select<LabelsAction>("What do you want to do?", [
        { label: "Add local label", value: "add-label" },
        { label: "Edit local label", value: "edit-label" },
        { label: "Remove local label", value: "remove-label" },
        { label: "Choose another instance", value: "choose-instance" },
        { label: "Save and finish", value: "save-finish" },
        { label: "Cancel", value: "cancel" },
      ]);

      switch (action) {
        case "add-label":
          labels = normalizeLabels([...labels, await promptForLabel(options.prompter)]);
          options.prompter.print(formatLabelsOverview(selectedInstance, labels));
          break;
        case "edit-label":
          labels = await promptForLabelEdit(options.prompter, labels);
          options.prompter.print(formatLabelsOverview(selectedInstance, labels));
          break;
        case "remove-label":
          labels = await promptForLabelRemoval(options.prompter, labels);
          options.prompter.print(formatLabelsOverview(selectedInstance, labels));
          break;
        case "choose-instance":
          selectedInstance = options.instances[await selectInstanceIndex(options.prompter, options.instances)];
          labels = normalizeLabels(await options.getLabels(selectedInstance.instanceId));
          options.prompter.print(formatLabelsOverview(selectedInstance, labels));
          break;
        case "save-finish":
          await options.writer.replaceLabels(selectedInstance.instanceId, labels);
          return {
            status: "saved",
            instanceId: selectedInstance.instanceId,
            labels,
            message: SAVED_MESSAGE,
          };
        case "cancel":
          return cancelledResult();
      }
    }
  } catch (error) {
    if (error instanceof SetupCancelledError) {
      return cancelledResult();
    }
    throw error;
  }
}

async function promptForLabel(prompter: SetupPrompter): Promise<LocalPeerLabel> {
  const category = await prompter.select("Label category", [
    { label: "Group", value: "group" },
    { label: "Project", value: "project" },
    { label: "Role", value: "role" },
    { label: "Skill", value: "skill" },
    { label: "Custom key", value: "custom" },
  ]);
  const key = category === "custom"
    ? normalizeAttributeKey(await prompter.input("Custom key", { required: true }))
    : category;
  const value = await prompter.input("Label value", { required: true });
  return { key, value: value.trim() };
}

async function promptForLabelEdit(prompter: SetupPrompter, labels: LocalPeerLabel[]): Promise<LocalPeerLabel[]> {
  if (labels.length === 0) {
    prompter.print("No local labels configured for this instance.");
    return labels;
  }

  const selectedIndex = await selectLabelIndex(prompter, "Label to edit", labels);
  const nextLabel = await promptForLabel(prompter);
  return normalizeLabels(labels.map((label, index) => (index === selectedIndex ? nextLabel : label)));
}

async function promptForLabelRemoval(prompter: SetupPrompter, labels: LocalPeerLabel[]): Promise<LocalPeerLabel[]> {
  if (labels.length === 0) {
    prompter.print("No local labels configured for this instance.");
    return labels;
  }

  const selectedIndex = await selectLabelIndex(prompter, "Label to remove", labels);
  return labels.filter((_label, index) => index !== selectedIndex);
}

async function selectInstanceIndex(prompter: SetupPrompter, instances: InstancePeerRecord[]): Promise<number> {
  const selectedKey = await prompter.select(
    "Instance to label",
    instances.map((instance, index) => ({
      label: formatInstance(instance),
      value: `instance-index-${index}`,
    })),
  );
  const match = /^instance-index-(\d+)$/.exec(selectedKey);
  return match ? Number(match[1]) : 0;
}

async function selectLabelIndex(
  prompter: SetupPrompter,
  message: string,
  labels: LocalPeerLabel[],
): Promise<number> {
  const selectedKey = await prompter.select(
    message,
    labels.map((label, index) => ({
      label: formatLabel(label),
      value: `label-index-${index}`,
    })),
  );
  const match = /^label-index-(\d+)$/.exec(selectedKey);
  return match ? Number(match[1]) : -1;
}

function normalizeLabels(labels: LocalPeerLabel[]): LocalPeerLabel[] {
  const seen = new Set<string>();
  const normalized: LocalPeerLabel[] = [];

  for (const label of labels) {
    const key = normalizeAttributeKey(label.key);
    const value = label.value.trim();
    if (!key || !value) {
      continue;
    }

    const id = `${key}\0${value}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({ key, value });
  }

  return normalized;
}

function formatInstancesOverview(instances: InstancePeerRecord[]): string {
  return ["Discovered instances:", ...instances.map((instance, index) => `  ${index + 1}. ${formatInstance(instance)}`)].join(
    "\n",
  );
}

function formatLabelsOverview(instance: InstancePeerRecord, labels: LocalPeerLabel[]): string {
  return [
    `Selected instance: ${formatInstance(instance)}`,
    "",
    "Local labels:",
    ...formatLabelList(labels),
  ].join("\n");
}

function formatLabelList(labels: LocalPeerLabel[]): string[] {
  if (labels.length === 0) {
    return ["  none"];
  }
  return labels.map((label, index) => `  ${index + 1}. ${formatLabel(label)}`);
}

function formatInstance(instance: InstancePeerRecord): string {
  const name = instance.instanceName ? `${instance.instanceName} ` : "";
  return `${name}${instance.instanceId} (${formatPublicAttributes(instance.userPublicAttributes ?? [])})`;
}

function formatPublicAttributes(attributes: UserPublicAttribute[]): string {
  if (attributes.length === 0) {
    return "public attributes: none";
  }
  return `public attributes: ${attributes.map(formatPublicAttribute).join(", ")}`;
}

function formatPublicAttribute(attribute: UserPublicAttribute): string {
  if (attribute.kind === "tag") {
    return attribute.label;
  }
  return `${attribute.key}: ${attribute.value}`;
}

function formatLabel(label: LocalPeerLabel): string {
  return `${label.key}: ${label.value}`;
}

function cancelledResult(): LabelsWizardResult {
  return {
    status: "cancelled",
    message: CANCELLED_MESSAGE,
  };
}
