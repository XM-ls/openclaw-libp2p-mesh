import type { InboundTargetConfig, MeshConfig } from "./types.js";
import {
  addInboundTarget,
  applyPluginConfig,
  buildNetworkConfig,
  disableInboundDelivery,
  getLibp2pMeshConfig,
  listConfiguredChannels,
  mergeNetworkConfig,
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
  | "add-target"
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
        pluginConfig = setInboundTargets(
          pluginConfig,
          await promptForInboundTargets(pluginConfig.inboundTargets ?? [], options, { promptInitialAction: true }),
        );
        break;
      case "preview-apply":
        return pluginConfig;
      case "cancel":
        return undefined;
    }
  }
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
