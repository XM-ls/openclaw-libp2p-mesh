import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginCliContext } from "openclaw/plugin-sdk/plugin-runtime";
import { type SetupCliDeps } from "./setup-cli.js";
import { type DebugCliDeps } from "./debug-cli.js";
import { type PromptCliDeps } from "./prompt-cli.js";
import { type UserProfileStore } from "./user-profile-store.js";
import type { SetupPrompter } from "./setup-wizard.js";
import type { InstancePeerStore, PeerLabelStore } from "./types.js";
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
    createUserMdAttributeSource?: (api: OpenClawPluginApi) => {
        loadTags(): Promise<Awaited<ReturnType<UserProfileStore["listAttributes"]>>>;
    };
    afterProfileSave?: () => Promise<void>;
};
export type LabelsCliDeps = {
    createPrompter?: (ctx: OpenClawPluginCliContext) => SetupPrompter;
    createPeerStore?: (api: OpenClawPluginApi) => Pick<InstancePeerStore, "list">;
    createPeerLabelStore?: (api: OpenClawPluginApi) => Pick<PeerLabelStore, "listRawLabels" | "replaceLabels">;
};
export type Libp2pMeshCliDeps = {
    setup?: SetupCliDeps;
    profile?: ProfileCliDeps;
    labels?: LabelsCliDeps;
    debug?: DebugCliDeps;
    prompt?: PromptCliDeps;
};
export declare function registerLibp2pMeshCli(api: OpenClawPluginApi, deps?: Libp2pMeshCliDeps): void;
export declare function registerLibp2pMeshProfileCli(api: OpenClawPluginApi, deps?: ProfileCliDeps): void;
export declare function registerLibp2pMeshProfileCommand(root: CliRootCommand, api: OpenClawPluginApi, ctx: OpenClawPluginCliContext, deps?: ProfileCliDeps): void;
export declare function registerLibp2pMeshLabelsCommand(root: CliRootCommand, api: OpenClawPluginApi, ctx: OpenClawPluginCliContext, deps?: LabelsCliDeps): void;
export {};
