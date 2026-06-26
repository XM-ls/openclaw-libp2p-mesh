export declare const LIBP2P_MESH_PROMPT_START = "<!-- libp2p-mesh:prompt:start -->";
export declare const LIBP2P_MESH_PROMPT_END = "<!-- libp2p-mesh:prompt:end -->";
export declare const LIBP2P_MESH_AGENT_PROMPT: string;
export type PromptInstallResult = {
    existed: boolean;
    path: string;
};
export declare function resolveAgentsMdPath(customPath?: string): string;
export declare function hasAgentPromptBlock(content: string): boolean;
export declare function installAgentPromptBlock(content: string): string;
export declare function installAgentPromptFile(agentsPath?: string): Promise<PromptInstallResult>;
export type PromptInstallLogger = {
    info?: (message: string) => void;
    warn?: (message: string) => void;
};
export type AutoInstallAgentPromptOptions = {
    agentsPath?: string;
    logger?: PromptInstallLogger;
    install?: (agentsPath?: string) => Promise<PromptInstallResult>;
};
export declare function autoInstallAgentPrompt(options?: AutoInstallAgentPromptOptions): Promise<void>;
