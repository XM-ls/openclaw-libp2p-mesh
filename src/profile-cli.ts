import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginCliContext } from "openclaw/plugin-sdk/plugin-runtime";
import {
  createReadlinePrompter,
  LIBP2P_MESH_CLI_REGISTRATION,
  registerLibp2pMeshSetupCommand,
  type ClosableSetupPrompter,
  type SetupCliDeps,
} from "./setup-cli.js";
import { registerLibp2pMeshDebugCommand, type DebugCliDeps } from "./debug-cli.js";
import { runProfileWizard } from "./profile-wizard.js";
import { createUserMdAttributeSource } from "./user-md-attributes.js";
import { createUserProfileStore, type UserProfileStore } from "./user-profile-store.js";
import type { SetupPrompter } from "./setup-wizard.js";

type CliRootCommand = {
  command(name: string): {
    description(text: string): {
      action(handler: () => Promise<void>): void;
    };
  };
};

export type ProfileCliDeps = {
  createPrompter?: (ctx: OpenClawPluginCliContext) => SetupPrompter;
  createProfileStore?: (api: OpenClawPluginApi) => Pick<UserProfileStore, "listAttributes" | "replaceAttributes">;
  createUserMdAttributeSource?: (api: OpenClawPluginApi) => { loadTags(): Promise<Awaited<ReturnType<UserProfileStore["listAttributes"]>>> };
};

export type Libp2pMeshCliDeps = {
  setup?: SetupCliDeps;
  profile?: ProfileCliDeps;
  debug?: DebugCliDeps;
};

export function registerLibp2pMeshCli(api: OpenClawPluginApi, deps: Libp2pMeshCliDeps = {}): void {
  api.registerCli((ctx) => {
    const root = ctx.program
      .command("libp2p-mesh")
      .description("Configure libp2p-mesh plugin.");

    registerLibp2pMeshSetupCommand(root, api, ctx, deps.setup);
    registerLibp2pMeshProfileCommand(root, api, ctx, deps.profile);
    registerLibp2pMeshDebugCommand(root, api, ctx, deps.debug);
  }, LIBP2P_MESH_CLI_REGISTRATION);
}

export function registerLibp2pMeshProfileCli(api: OpenClawPluginApi, deps: ProfileCliDeps = {}): void {
  api.registerCli((ctx) => {
    const root = ctx.program
      .command("libp2p-mesh")
      .description("Configure libp2p-mesh plugin.");

    registerLibp2pMeshProfileCommand(root, api, ctx, deps);
  }, LIBP2P_MESH_CLI_REGISTRATION);
}

export function registerLibp2pMeshProfileCommand(
  root: CliRootCommand,
  api: OpenClawPluginApi,
  ctx: OpenClawPluginCliContext,
  deps: ProfileCliDeps = {},
): void {
  root
    .command("profile")
    .description("Manage libp2p-mesh public profile attributes.")
    .action(async () => {
      const prompter = (deps.createPrompter?.(ctx) ?? createReadlinePrompter()) as ClosableSetupPrompter;
      const profileStore = deps.createProfileStore?.(api) ?? createUserProfileStore({ logger: api.logger });
      const userMdAttributeSource = deps.createUserMdAttributeSource?.(api) ?? createUserMdAttributeSource({ logger: api.logger });

      try {
        const result = await runProfileWizard({
          prompter,
          readOnlyTags: await userMdAttributeSource.loadTags(),
          profileAttributes: await profileStore.listAttributes(),
          writer: {
            async replaceAttributes(attributes) {
              await profileStore.replaceAttributes(attributes);
            },
          },
        });
        prompter.print(result.message);
      } finally {
        prompter.close?.();
      }
    });
}
