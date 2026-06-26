import type { MeshConfig } from "./types.js";
import { type OpenClawConfigLike } from "./setup-config.js";
export declare class SetupCancelledError extends Error {
    constructor();
}
export type SetupPromptChoice = "continue" | "cancel" | "lan" | "cross-network" | "relay-node" | "tools-only" | "add-targets" | "sync-from-channels" | "disable-inbound" | "skip-inbound" | "network-mode" | "inbound-targets" | "convert-legacy-inbound" | "keep-legacy-inbound" | "replace-legacy-inbound" | "add-target" | "edit-target" | "remove-target" | "finish-targets" | "preview-apply";
export type SetupPrompter = {
    confirm(message: string, defaultValue?: boolean): Promise<boolean>;
    select<T extends string>(message: string, choices: Array<{
        label: string;
        value: T;
    }>): Promise<T>;
    input(message: string, options?: {
        defaultValue?: string;
        required?: boolean;
    }): Promise<string>;
    print(message: string): void;
};
export type SetupConfigWriter = {
    write(nextConfig: OpenClawConfigLike): Promise<void>;
};
export type SetupWizardResult = {
    status: "applied";
    nextConfig: OpenClawConfigLike;
    message: string;
} | {
    status: "cancelled";
    message: string;
};
export type RunSetupWizardOptions = {
    currentConfig: OpenClawConfigLike;
    prompter: SetupPrompter;
    writer: SetupConfigWriter;
};
export declare function runSetupWizard(options: RunSetupWizardOptions): Promise<SetupWizardResult>;
export declare function formatPluginEntryPreview(pluginConfig: MeshConfig): string;
