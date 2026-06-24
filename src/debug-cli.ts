import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginCliContext } from "openclaw/plugin-sdk/plugin-runtime";
import {
  createReadlinePrompter,
  LIBP2P_MESH_CLI_REGISTRATION,
  type ClosableSetupPrompter,
} from "./setup-cli.js";
import {
  applyAnnounceLogDetail,
  getAnnounceLogDetail,
  type OpenClawConfigLike,
} from "./setup-config.js";
import type { SetupPrompter } from "./setup-wizard.js";
import { runDebugWizard } from "./debug-wizard.js";
import type { AnnounceLogDetail } from "./types.js";

const DEBUG_CLI_AFTER_WRITE = {
  mode: "none",
  reason: "libp2p-mesh debug config updated; restart manually to apply gateway changes.",
} as const;

type CliRootCommand = {
  command(name: string): {
    description(text: string): {
      action(handler: () => Promise<void>): void;
    };
  };
};

export type DebugConfigWriter = {
  saveAnnounceLogDetail(detail: AnnounceLogDetail): Promise<void>;
};

export type DebugCliDeps = {
  createPrompter?: (ctx: OpenClawPluginCliContext) => SetupPrompter;
  createWriter?: (api: OpenClawPluginApi) => DebugConfigWriter;
};

export function registerLibp2pMeshDebugCli(api: OpenClawPluginApi, deps: DebugCliDeps = {}): void {
  api.registerCli((ctx) => {
    const root = ctx.program
      .command("libp2p-mesh")
      .description("Configure libp2p-mesh plugin.");

    registerLibp2pMeshDebugCommand(root, api, ctx, deps);
  }, LIBP2P_MESH_CLI_REGISTRATION);
}

export function registerLibp2pMeshDebugCommand(
  root: CliRootCommand,
  api: OpenClawPluginApi,
  ctx: OpenClawPluginCliContext,
  deps: DebugCliDeps = {},
): void {
  root
    .command("debug")
    .description("Manage libp2p-mesh debug logging config.")
    .action(async () => {
      const prompter = (deps.createPrompter?.(ctx) ?? createReadlinePrompter()) as ClosableSetupPrompter;
      const writer = deps.createWriter?.(api) ?? createOpenClawDebugConfigWriter(api);
      try {
        const result = await runDebugWizard({
          prompter,
          current: getAnnounceLogDetail(ctx.config as OpenClawConfigLike),
          writer,
        });
        prompter.print(result.message);
      } finally {
        prompter.close?.();
      }
    });
}

function createOpenClawDebugConfigWriter(api: OpenClawPluginApi): DebugConfigWriter {
  return {
    async saveAnnounceLogDetail(detail) {
      await api.runtime.config.mutateConfigFile({
        afterWrite: DEBUG_CLI_AFTER_WRITE,
        mutate(draft) {
          const nextConfig = applyAnnounceLogDetail(draft as OpenClawConfigLike, detail);
          replaceConfig(draft as OpenClawConfig, nextConfig as OpenClawConfig);
        },
      });
    },
  };
}

function replaceConfig(draft: OpenClawConfig, nextConfig: OpenClawConfig): void {
  for (const key of Object.keys(draft) as Array<keyof OpenClawConfig>) {
    delete draft[key];
  }
  Object.assign(draft, structuredClone(nextConfig));
}
