import { createReadlinePrompter, LIBP2P_MESH_CLI_REGISTRATION, } from "./setup-cli.js";
import { hasAgentPromptBlock, installAgentPromptFile, resolveAgentsMdPath, } from "./prompt-config.js";
import { readFile } from "node:fs/promises";
export function registerLibp2pMeshPromptCli(api, deps = {}) {
    api.registerCli((ctx) => {
        const root = ctx.program
            .command("libp2p-mesh")
            .description("Configure libp2p-mesh plugin.");
        registerLibp2pMeshPromptCommand(root, ctx, deps);
    }, LIBP2P_MESH_CLI_REGISTRATION);
}
export function registerLibp2pMeshPromptCommand(root, ctx, deps = {}) {
    const prompt = root
        .command("prompt")
        .description("Manage libp2p-mesh AGENTS.md prompt.");
    prompt
        .command("install")
        .description("Install the bundled libp2p-mesh agent prompt.")
        .action(async () => {
        const prompter = (deps.createPrompter?.(ctx) ?? createReadlinePrompter());
        const agentsPath = resolveAgentsMdPath(deps.agentsPath);
        try {
            const existing = await readFile(agentsPath, "utf8").catch((error) => {
                if (error.code === "ENOENT") {
                    return "";
                }
                throw error;
            });
            if (hasAgentPromptBlock(existing)) {
                prompter.print("libp2p-mesh prompt already installed.");
                const confirmed = await prompter.confirm("Update it to the bundled latest version?", true);
                if (!confirmed) {
                    prompter.print("Cancelled. AGENTS.md was not changed.");
                    return;
                }
            }
            else {
                prompter.print(`Installing libp2p-mesh agent prompt into ${agentsPath}`);
            }
            await installAgentPromptFile(agentsPath);
            prompter.print("Done.");
            prompter.print("Restart the gateway or agent session to apply the updated prompt.");
        }
        finally {
            prompter.close?.();
        }
    });
}
//# sourceMappingURL=prompt-cli.js.map