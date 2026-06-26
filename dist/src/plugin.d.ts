import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createInstanceRouter } from "./instance-router.js";
import { createMeshNetwork } from "./mesh.js";
import { type AutoInstallAgentPromptOptions } from "./prompt-config.js";
export type Libp2pMeshPluginDeps = {
    createMeshNetwork?: typeof createMeshNetwork;
    createInstanceRouter?: typeof createInstanceRouter;
    autoInstallAgentPrompt?: (options?: AutoInstallAgentPromptOptions) => Promise<void>;
};
export declare function registerLibp2pMesh(api: OpenClawPluginApi): void;
export declare function registerLibp2pMeshWithDeps(api: OpenClawPluginApi, deps?: Libp2pMeshPluginDeps): void;
