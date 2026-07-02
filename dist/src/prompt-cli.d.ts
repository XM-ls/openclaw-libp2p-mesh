import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginCliContext } from "openclaw/plugin-sdk/plugin-runtime";
import type { SetupPrompter } from "./setup-wizard.js";
type CliCommand = {
    command(name: string): CliCommand;
    description(text: string): CliCommand;
    action(handler: () => Promise<void>): void;
};
type PromptRootCommand = {
    command(name: string): CliCommand;
};
export type PromptCliDeps = {
    agentsPath?: string;
    createPrompter?: (ctx: OpenClawPluginCliContext) => SetupPrompter;
};
export declare function registerLibp2pMeshPromptCli(api: OpenClawPluginApi, deps?: PromptCliDeps): void;
export declare function registerLibp2pMeshPromptCommand(root: PromptRootCommand, ctx: OpenClawPluginCliContext, deps?: PromptCliDeps): void;
export {};
