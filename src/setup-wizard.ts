import type { InboundTargetConfig, MeshConfig } from "./types.js";
import {
  addInboundTarget,
  applyPluginConfig,
  buildNetworkConfig,
  disableInboundDelivery,
  getLibp2pMeshConfig,
  listConfiguredChannels,
  mergeNetworkConfig,
  migrateLegacyInboundConfig,
  setInboundTargets,
  type OpenClawConfigLike,
  type SetupMode,
} from "./setup-config.js";

const MANUAL_CHANNEL_VALUE = "__manual__";
const CANCELLED_MESSAGE = "Configuration cancelled. No changes were written.";
const APPLIED_MESSAGE = "Config updated.\n\nRestart the gateway to apply changes:\nopenclaw gateway restart";

export class SetupCancelledError extends Error {
  constructor() {
    super(CANCELLED_MESSAGE);
    this.name = "SetupCancelledError";
  }
}

export type SetupPromptChoice =
  | "continue"
  | "cancel"
  | "lan"
  | "cross-network"
  | "relay-node"
  | "tools-only"
  | "add-targets"
  | "disable-inbound"
  | "skip-inbound"
  | "network-mode"
  | "inbound-targets"
  | "convert-legacy-inbound"
  | "keep-legacy-inbound"
  | "replace-legacy-inbound"
  | "add-target"
  | "edit-target"
  | "remove-target"
  | "finish-targets"
  | "preview-apply";

export type SetupPrompter = {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  select<T extends string>(message: string, choices: Array<{ label: string; value: T }>): Promise<T>;
  input(message: string, options?: { defaultValue?: string; required?: boolean }): Promise<string>;
  print(message: string): void;
};

export type SetupConfigWriter = {
  write(nextConfig: OpenClawConfigLike): Promise<void>;
};

export type SetupWizardResult =
  | { status: "applied"; nextConfig: OpenClawConfigLike; message: string }
  | { status: "cancelled"; message: string };

export type RunSetupWizardOptions = {
  currentConfig: OpenClawConfigLike;
  prompter: SetupPrompter;
  writer: SetupConfigWriter;
};

export async function runSetupWizard(options: RunSetupWizardOptions): Promise<SetupWizardResult> {
  try {
    const existingConfig = cloneMeshConfig(getLibp2pMeshConfig(options.currentConfig));
    const pluginConfig = existingConfig
      ? await runExistingConfigFlow(existingConfig, options)
      : await runFirstConfigFlow(options);

    if (!pluginConfig) {
      return cancelledResult();
    }

    const nextConfig = applyPluginConfig(options.currentConfig, pluginConfig);
    options.prompter.print(formatPluginEntryPreview(pluginConfig));

    const shouldApply = await options.prompter.confirm("Apply this config?", true);
    if (!shouldApply) {
      return cancelledResult();
    }

    await options.writer.write(nextConfig);
    return {
      status: "applied",
      nextConfig,
      message: APPLIED_MESSAGE,
    };
  } catch (error) {
    if (error instanceof SetupCancelledError) {
      return cancelledResult();
    }
    throw error;
  }
}

export function formatPluginEntryPreview(pluginConfig: MeshConfig): string {
  return `Preview: plugins.entries["libp2p-mesh"]\n\n${JSON.stringify(
    {
      enabled: true,
      config: pluginConfig,
    },
    null,
    2,
  )}`;
}

async function runFirstConfigFlow(options: RunSetupWizardOptions): Promise<MeshConfig | undefined> {
  options.prompter.print(
    'libp2p-mesh is not configured yet.\n\nThis wizard will create:\nplugins.entries["libp2p-mesh"]',
  );
  const shouldContinue = await options.prompter.confirm("Continue?", true);
  if (!shouldContinue) {
    return undefined;
  }

  const mode = await selectSetupMode(options.prompter);
  let pluginConfig = await buildNetworkConfigFromPrompts(mode, options.prompter);

  const inboundChoice = await options.prompter.select("Configure inbound delivery targets?", [
    { label: "Add one or more targets", value: "add-targets" },
    { label: "Disable inbound delivery for now", value: "disable-inbound" },
    { label: "Skip for now", value: "skip-inbound" },
  ]);

  switch (inboundChoice) {
    case "add-targets":
      pluginConfig = setInboundTargets(pluginConfig, await promptForInboundTargets([], options));
      break;
    case "disable-inbound":
      pluginConfig = disableInboundDelivery(pluginConfig);
      break;
    case "skip-inbound":
      break;
  }

  return pluginConfig;
}

async function runExistingConfigFlow(
  existingConfig: MeshConfig,
  options: RunSetupWizardOptions,
): Promise<MeshConfig | undefined> {
  let pluginConfig = cloneMeshConfig(existingConfig) ?? {};

  while (true) {
    options.prompter.print(formatCurrentConfig(pluginConfig));
    const editChoice = await options.prompter.select("What do you want to edit?", [
      { label: "Network mode", value: "network-mode" },
      { label: "Inbound delivery targets", value: "inbound-targets" },
      { label: "Preview and apply", value: "preview-apply" },
      { label: "Cancel", value: "cancel" },
    ]);

    switch (editChoice) {
      case "network-mode": {
        const mode = await selectSetupMode(options.prompter);
        pluginConfig = mergeNetworkConfig(pluginConfig, await buildNetworkConfigFromPrompts(mode, options.prompter));
        break;
      }
      case "inbound-targets":
        pluginConfig = await promptForExistingInboundConfig(pluginConfig, options);
        break;
      case "preview-apply":
        return pluginConfig;
      case "cancel":
        return undefined;
    }
  }
}

async function promptForExistingInboundConfig(
  pluginConfig: MeshConfig,
  options: RunSetupWizardOptions,
): Promise<MeshConfig> {
  if (hasLegacyOnlyInboundConfig(pluginConfig)) {
    const migrationChoice = await options.prompter.select("Legacy inbound target config found. How do you want to continue?", [
      { label: "Convert legacy target to inboundTargets", value: "convert-legacy-inbound" },
      { label: "Keep legacy inboundChannel/inboundTarget", value: "keep-legacy-inbound" },
      { label: "Replace with new inboundTargets", value: "replace-legacy-inbound" },
    ]);

    switch (migrationChoice) {
      case "convert-legacy-inbound":
        return migrateLegacyInboundConfig(pluginConfig, "convert");
      case "keep-legacy-inbound":
        return migrateLegacyInboundConfig(pluginConfig, "keep");
      case "replace-legacy-inbound":
        return migrateLegacyInboundConfig(pluginConfig, "replace", await promptForInboundTargets([], options));
    }
  }

  const editResult = await promptForInboundTargetEdits(pluginConfig.inboundTargets ?? [], options);
  switch (editResult.action) {
    case "save":
      return setInboundTargets(pluginConfig, editResult.targets);
    case "disable":
      return disableInboundDelivery(pluginConfig);
  }
}

function hasLegacyOnlyInboundConfig(pluginConfig: MeshConfig): boolean {
  return Boolean(pluginConfig.inboundChannel && pluginConfig.inboundTarget && !Array.isArray(pluginConfig.inboundTargets));
}

async function selectSetupMode(prompter: SetupPrompter): Promise<SetupMode> {
  return prompter.select("Choose setup mode:", [
    { label: "LAN: same WiFi / local network", value: "lan" },
    { label: "Cross-network: use bootstrap/relay", value: "cross-network" },
    { label: "Relay node: this machine has a public address", value: "relay-node" },
    { label: "Tools only: no inbound delivery", value: "tools-only" },
  ]);
}

async function buildNetworkConfigFromPrompts(mode: SetupMode, prompter: SetupPrompter): Promise<MeshConfig> {
  switch (mode) {
    case "cross-network":
      return buildNetworkConfig("cross-network", {
        crossNetwork: {
          bootstrapList: await promptForAddressList(prompter, "Bootstrap multiaddr", "Add another bootstrap?"),
          relayList: await promptForOptionalAddressList(prompter, "Relay multiaddr", "Add another relay?"),
        },
      });
    case "relay-node":
      return buildNetworkConfig("relay-node", {
        relayNode: {
          listenAddrs: [await prompter.input("Listen address", { required: true })],
          announceAddrs: [await prompter.input("Public announce address", { required: true })],
        },
      });
    default:
      return buildNetworkConfig(mode);
  }
}

async function promptForAddressList(
  prompter: SetupPrompter,
  message: string,
  addAnotherMessage: string,
): Promise<string[]> {
  const addresses = [await prompter.input(message, { required: true })];
  while (await prompter.confirm(addAnotherMessage, false)) {
    addresses.push(await prompter.input(message, { required: true }));
  }
  return addresses;
}

async function promptForOptionalAddressList(
  prompter: SetupPrompter,
  message: string,
  addAnotherMessage: string,
): Promise<string[]> {
  const firstAddress = await prompter.input(message);
  if (!firstAddress) {
    return [];
  }
  const addresses = [firstAddress];
  while (await prompter.confirm(addAnotherMessage, false)) {
    addresses.push(await prompter.input(message, { required: true }));
  }
  return addresses;
}

async function promptForInboundTargets(
  existingTargets: InboundTargetConfig[],
  options: RunSetupWizardOptions,
  promptOptions?: { promptInitialAction?: boolean },
): Promise<InboundTargetConfig[]> {
  let targets = existingTargets.map((target) => ({ ...target }));
  let action: "add-target" | "finish-targets" = promptOptions?.promptInitialAction
    ? await options.prompter.select("What do you want to do?", [
        { label: "Add target", value: "add-target" },
        { label: "Back", value: "finish-targets" },
      ])
    : "add-target";

  while (action === "add-target") {
    const channel = await promptForChannel(options);
    const target = await options.prompter.input("Target", { required: true });
    const addResult = addInboundTarget(targets, { channel, target });

    if (addResult.ok) {
      targets = addResult.targets;
    } else {
      options.prompter.print(addResult.error);
      continue;
    }

    action = await options.prompter.select("Add another target?", [
      { label: "Add another", value: "add-target" },
      { label: "Finish target setup", value: "finish-targets" },
    ]);
  }

  return targets;
}

type InboundTargetEditResult =
  | { action: "save"; targets: InboundTargetConfig[] }
  | { action: "disable" };

async function promptForInboundTargetEdits(
  existingTargets: InboundTargetConfig[],
  options: RunSetupWizardOptions,
): Promise<InboundTargetEditResult> {
  let targets = existingTargets.map((target) => ({ ...target }));

  while (true) {
    const action = await options.prompter.select("What do you want to do?", [
      { label: "Add target", value: "add-target" },
      { label: "Edit target", value: "edit-target" },
      { label: "Remove target", value: "remove-target" },
      { label: "Disable inbound delivery", value: "disable-inbound" },
      { label: "Back", value: "finish-targets" },
    ]);

    switch (action) {
      case "add-target":
        targets = await promptForOneInboundTarget(targets, options);
        break;
      case "edit-target":
        targets = await promptForInboundTargetEdit(targets, options);
        break;
      case "remove-target":
        targets = await promptForInboundTargetRemoval(targets, options);
        break;
      case "disable-inbound":
        return { action: "disable" };
      case "finish-targets":
        return { action: "save", targets };
    }
  }
}

async function promptForOneInboundTarget(
  targets: InboundTargetConfig[],
  options: RunSetupWizardOptions,
): Promise<InboundTargetConfig[]> {
  const channel = await promptForChannel(options);
  const target = await options.prompter.input("Target", { required: true });
  const addResult = addInboundTarget(targets, { channel, target });

  if (addResult.ok) {
    return addResult.targets;
  }

  options.prompter.print(addResult.error);
  return targets;
}

async function promptForInboundTargetEdit(
  targets: InboundTargetConfig[],
  options: RunSetupWizardOptions,
): Promise<InboundTargetConfig[]> {
  if (targets.length === 0) {
    options.prompter.print("No inbound targets configured.");
    return targets;
  }

  const selectedIndex = await selectInboundTargetIndex(options.prompter, "Target to edit", targets);
  const channel = await promptForChannel(options);
  const target = await options.prompter.input("Target", { required: true });
  const duplicate = targets.some(
    (existingTarget, index) => index !== selectedIndex && existingTarget.channel === channel && existingTarget.target === target,
  );

  if (duplicate) {
    options.prompter.print(`inbound target already exists: ${channel} / ${target}`);
    return targets;
  }

  return targets.map((existingTarget, index) =>
    index === selectedIndex
      ? {
          ...existingTarget,
          channel,
          target,
        }
      : { ...existingTarget },
  );
}

async function promptForInboundTargetRemoval(
  targets: InboundTargetConfig[],
  options: RunSetupWizardOptions,
): Promise<InboundTargetConfig[]> {
  if (targets.length === 0) {
    options.prompter.print("No inbound targets configured.");
    return targets;
  }

  const selectedIndex = await selectInboundTargetIndex(options.prompter, "Target to remove", targets);
  return targets.filter((_target, index) => index !== selectedIndex).map((target) => ({ ...target }));
}

async function selectInboundTargetIndex(
  prompter: SetupPrompter,
  message: string,
  targets: InboundTargetConfig[],
): Promise<number> {
  const selectedKey = await prompter.select(
    message,
    targets.map((target, index) => ({
      label: `${target.id ?? `target-${index + 1}`}     ${target.channel} / ${target.target}`,
      value: `target-index-${index}`,
    })),
  );
  const indexMatch = /^target-index-(\d+)$/.exec(selectedKey);
  if (indexMatch) {
    return Number(indexMatch[1]);
  }

  const idIndex = targets.findIndex((target) => target.id === selectedKey);
  if (idIndex >= 0) {
    return idIndex;
  }

  const legacySyntheticKeyMatch = /^target-(\d+)$/.exec(selectedKey);
  if (legacySyntheticKeyMatch) {
    return Number(legacySyntheticKeyMatch[1]) - 1;
  }

  return -1;
}

async function promptForChannel(options: RunSetupWizardOptions): Promise<string> {
  const channelChoices = [
    ...listConfiguredChannels(options.currentConfig).map((channel) => ({ label: channel, value: channel })),
    { label: "Manually enter channel name", value: MANUAL_CHANNEL_VALUE },
  ];
  const channel = await options.prompter.select("Channel", channelChoices);

  if (channel === MANUAL_CHANNEL_VALUE) {
    return options.prompter.input("Channel name", { required: true });
  }

  return channel;
}

function formatCurrentConfig(pluginConfig: MeshConfig): string {
  const targets = pluginConfig.inboundTargets ?? [];
  const targetLines =
    targets.length > 0
      ? targets.map((target, index) => `  ${index + 1}. ${target.id ?? "(unnamed)"}     ${target.channel} / ${target.target}`)
      : ["  none"];

  return [`Current libp2p-mesh config:`, `- discovery: ${pluginConfig.discovery ?? "(unset)"}`, "- inbound targets:", ...targetLines].join(
    "\n",
  );
}

function cloneMeshConfig(config: MeshConfig | undefined): MeshConfig | undefined {
  if (!config) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(config)) as MeshConfig;
}

function cancelledResult(): SetupWizardResult {
  return {
    status: "cancelled",
    message: CANCELLED_MESSAGE,
  };
}
