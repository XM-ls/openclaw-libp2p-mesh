import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginCliContext } from "openclaw/plugin-sdk/plugin-runtime";
import type { SetupPrompter } from "./setup-wizard.js";
import type { AnnounceLogDetail } from "./types.js";
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
export declare function registerLibp2pMeshDebugCli(api: OpenClawPluginApi, deps?: DebugCliDeps): void;
export declare function registerLibp2pMeshDebugCommand(root: CliRootCommand, api: OpenClawPluginApi, ctx: OpenClawPluginCliContext, deps?: DebugCliDeps): void;
export {};
