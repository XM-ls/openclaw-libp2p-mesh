import type { InboundTargetConfig, MeshConfig } from "./types.js";
import {
  addInboundTarget,
  applyPluginConfig,
  buildNetworkEntryConfig,
  buildPublicRelayNodeConfig,
  disableInboundDelivery,
  getLibp2pMeshConfig,
  listConfiguredChannels,
  planInboundTargetSync,
  migrateLegacyInboundConfig,
  setInboundTargets,
  type OpenClawConfigLike,
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
  | "add-targets"
  | "sync-from-channels"
  | "disable-inbound"
  | "skip-inbound"
  | "network-entry-addresses"
  | "public-relay-node"
  | "inbound-targets"
  | "convert-legacy-inbound"
  | "keep-legacy-inbound"
  | "replace-legacy-inbound"
  | "add-target"
  | "edit-target"
  | "remove-target"
  | "finish-targets";

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

  options.prompter.print(
    "Network discovery is enabled automatically.\nmDNS, DHT, NAT traversal, relay transport, and hole punching are enabled by default.",
  );
  let pluginConfig = await promptForNetworkEntryConfig({}, options.prompter, { keepExistingOnEmpty: false });

  const inboundChoice = await options.prompter.select("Configure where received P2P messages should appear?", [
    { label: "Sync from existing channels", value: "sync-from-channels" },
    { label: "Add a target manually", value: "add-targets" },
    { label: "Do not receive P2P messages in local channels", value: "disable-inbound" },
    { label: "Leave unchanged for now", value: "skip-inbound" },
  ]);

  switch (inboundChoice) {
    case "sync-from-channels":
      pluginConfig = await syncInboundTargetsFromConfiguredChannels(pluginConfig, options);
      break;
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

  options.prompter.print(formatCurrentConfig(pluginConfig));
  const editChoice = await options.prompter.select("What do you want to edit?", [
    { label: "Sync inbound targets from channels", value: "sync-from-channels" },
    { label: "Network entry addresses", value: "network-entry-addresses" },
    { label: "Public relay-node settings", value: "public-relay-node" },
    { label: "Where received P2P messages appear", value: "inbound-targets" },
    { label: "Cancel", value: "cancel" },
  ]);

  switch (editChoice) {
    case "sync-from-channels":
      return syncInboundTargetsFromConfiguredChannels(pluginConfig, options);
    case "network-entry-addresses":
      return promptForNetworkEntryConfig(pluginConfig, options.prompter, { keepExistingOnEmpty: true });
    case "public-relay-node":
      return promptForPublicRelayNodeConfig(pluginConfig, options.prompter);
    case "inbound-targets":
      return promptForExistingInboundConfig(pluginConfig, options);
    case "cancel":
      return undefined;
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

async function syncInboundTargetsFromConfiguredChannels(
  pluginConfig: MeshConfig,
  options: RunSetupWizardOptions,
): Promise<MeshConfig> {
  const configuredChannels = listConfiguredChannels(options.currentConfig);
  const plan = planInboundTargetSync(pluginConfig.inboundTargets ?? [], configuredChannels);
  if (plan.missingChannels.length === 0) {
    options.prompter.print("All configured channels already have inbound targets.");
    return setInboundTargets(pluginConfig, plan.targets);
  }

  options.prompter.print(formatInboundSyncPlan(plan));
  let targets = plan.targets.map((target) => ({ ...target }));
  const added: InboundTargetConfig[] = [];
  const skipped: string[] = [];

  for (const channel of plan.missingChannels) {
    const target = (await options.prompter.input(`${targetPromptForChannel(channel)} (leave empty to skip)`, { required: false })).trim();
    if (!target) {
      skipped.push(channel);
      continue;
    }

    const addResult = addInboundTarget(targets, { channel, target });
    if (!addResult.ok) {
      options.prompter.print(addResult.error);
      continue;
    }
    targets = addResult.targets;
    added.push(addResult.added);
  }

  options.prompter.print(formatInboundSyncResult({ added, skipped }));
  return setInboundTargets(pluginConfig, targets);
}

function formatInboundSyncPlan(plan: { targets: InboundTargetConfig[]; missingChannels: string[] }): string {
  const alreadyConfigured =
    plan.targets.length > 0 ? plan.targets.map((target) => `  - ${formatInboundTargetLine(target)}`) : ["  none"];
  const missingChannels =
    plan.missingChannels.length > 0 ? plan.missingChannels.map((channel) => `  - ${channel}`) : ["  none"];

  return [
    "Already configured:",
    ...alreadyConfigured,
    "",
    "Channels without inbound targets:",
    ...missingChannels,
    "",
    "Leave a target empty to skip that channel.",
  ].join("\n");
}

function formatInboundSyncResult(result: { added: InboundTargetConfig[]; skipped: string[] }): string {
  const lines: string[] = [];

  if (result.added.length > 0) {
    lines.push("Added:", ...result.added.map((target) => `  - ${formatInboundTargetLine(target)}`));
  } else {
    lines.push("No inbound targets were added.");
  }

  if (result.skipped.length > 0) {
    lines.push("", "Skipped:", ...result.skipped.map((channel) => `  - ${channel}`));
  }

  return lines.join("\n");
}

function formatInboundTargetLine(target: InboundTargetConfig): string {
  return `${target.id ?? "(unnamed)"}     ${target.channel} / ${target.target}`;
}

function hasLegacyOnlyInboundConfig(pluginConfig: MeshConfig): boolean {
  return Boolean(pluginConfig.inboundChannel && pluginConfig.inboundTarget && !Array.isArray(pluginConfig.inboundTargets));
}

async function promptForNetworkEntryConfig(
  existing: MeshConfig,
  prompter: SetupPrompter,
  options: { keepExistingOnEmpty: boolean },
): Promise<MeshConfig> {
  const bootstrapList = await promptForOptionalAddressList(
    prompter,
    options.keepExistingOnEmpty
      ? "Bootstrap multiaddr (optional, leave empty to keep unchanged)"
      : "Bootstrap multiaddr (optional, leave empty to skip)",
    "Add another bootstrap?",
  );
  const relayList = await promptForOptionalAddressList(
    prompter,
    options.keepExistingOnEmpty
      ? "Relay multiaddr (optional, leave empty to keep unchanged)"
      : "Relay multiaddr (optional, leave empty to skip)",
    "Add another relay?",
  );

  if (options.keepExistingOnEmpty) {
    return {
      ...existing,
      ...(bootstrapList.length > 0 ? { bootstrapList } : {}),
      ...(relayList.length > 0 ? { relayList } : {}),
    };
  }

  return {
    ...existing,
    ...buildNetworkEntryConfig({ bootstrapList, relayList }),
  };
}

async function promptForPublicRelayNodeConfig(existing: MeshConfig, prompter: SetupPrompter): Promise<MeshConfig> {
  const enabled = await prompter.confirm("Enable this machine as a public relay node?", false);
  const relayConfig = enabled
    ? buildPublicRelayNodeConfig({
        enabled: true,
        listenAddrs: [
          await prompter.input("Listen address", {
            defaultValue: "/ip4/0.0.0.0/tcp/4001",
            required: true,
          }),
        ],
        announceAddrs: await promptForOptionalAddressList(
          prompter,
          "Public announce address (optional, leave empty to skip)",
          "Add another public announce address?",
        ),
      })
    : buildPublicRelayNodeConfig({ enabled: false });

  return {
    ...existing,
    enableCircuitRelayServer: relayConfig.enableCircuitRelayServer,
    ...(relayConfig.listenAddrs ? { listenAddrs: relayConfig.listenAddrs } : {}),
    ...(relayConfig.announceAddrs ? { announceAddrs: relayConfig.announceAddrs } : {}),
  };
}

async function promptForOptionalAddressList(
  prompter: SetupPrompter,
  message: string,
  addAnotherMessage: string,
): Promise<string[]> {
  const firstAddress = await prompter.input(message, { required: false });
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
        { label: "Finish editing", value: "finish-targets" },
      ])
    : "add-target";

  while (action === "add-target") {
    const channel = await promptForChannel(options);
    const target = await options.prompter.input(targetPromptForChannel(channel), { required: true });
    const addResult = addInboundTarget(targets, { channel, target });

    if (addResult.ok) {
      targets = addResult.targets;
    } else {
      options.prompter.print(addResult.error);
      continue;
    }

    action = await options.prompter.select("Add another target?", [
      { label: "Add another", value: "add-target" },
      { label: "Finish editing", value: "finish-targets" },
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
      { label: "Finish editing", value: "finish-targets" },
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
  const target = await options.prompter.input(targetPromptForChannel(channel), { required: true });
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
  const target = await options.prompter.input(targetPromptForChannel(channel), { required: true });
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

function targetPromptForChannel(channel: string): string {
  return `Target for ${channel}`;
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
