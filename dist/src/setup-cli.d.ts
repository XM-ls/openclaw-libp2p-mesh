import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginCliContext } from "openclaw/plugin-sdk/plugin-runtime";
import { type SetupConfigWriter, type SetupPrompter } from "./setup-wizard.js";
export declare const LIBP2P_MESH_CLI_REGISTRATION: {
    commands: string[];
    descriptors: {
        name: string;
        description: string;
        hasSubcommands: boolean;
    }[];
};
export type ClosableSetupPrompter = SetupPrompter & {
    close?: () => void;
};
export type SetupCliDeps = {
    createPrompter?: (ctx: OpenClawPluginCliContext) => SetupPrompter;
    createWriter?: (api: OpenClawPluginApi) => SetupConfigWriter;
};
export declare function registerLibp2pMeshSetupCli(api: OpenClawPluginApi, deps?: SetupCliDeps): void;
export declare function registerLibp2pMeshSetupCommand(root: {
    command(name: string): {
        description(text: string): {
            action(handler: () => Promise<void>): void;
        };
    };
}, api: OpenClawPluginApi, ctx: OpenClawPluginCliContext, deps?: SetupCliDeps): void;
export declare function createReadlinePrompter(): ClosableSetupPrompter;
