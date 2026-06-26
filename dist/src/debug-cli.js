import { createReadlinePrompter, LIBP2P_MESH_CLI_REGISTRATION, } from "./setup-cli.js";
import { applyAnnounceLogDetail, getAnnounceLogDetail, } from "./setup-config.js";
import { runDebugWizard } from "./debug-wizard.js";
const DEBUG_CLI_AFTER_WRITE = {
    mode: "none",
    reason: "libp2p-mesh debug config updated; restart manually to apply gateway changes.",
};
export function registerLibp2pMeshDebugCli(api, deps = {}) {
    api.registerCli((ctx) => {
        const root = ctx.program
            .command("libp2p-mesh")
            .description("Configure libp2p-mesh plugin.");
        registerLibp2pMeshDebugCommand(root, api, ctx, deps);
    }, LIBP2P_MESH_CLI_REGISTRATION);
}
export function registerLibp2pMeshDebugCommand(root, api, ctx, deps = {}) {
    root
        .command("debug")
        .description("Manage libp2p-mesh debug logging config.")
        .action(async () => {
        const prompter = (deps.createPrompter?.(ctx) ?? createReadlinePrompter());
        const writer = deps.createWriter?.(api) ?? createOpenClawDebugConfigWriter(api);
        try {
            const result = await runDebugWizard({
                prompter,
                current: getAnnounceLogDetail(ctx.config),
                writer,
            });
            prompter.print(result.message);
        }
        finally {
            prompter.close?.();
        }
    });
}
function createOpenClawDebugConfigWriter(api) {
    return {
        async saveAnnounceLogDetail(detail) {
            await api.runtime.config.mutateConfigFile({
                afterWrite: DEBUG_CLI_AFTER_WRITE,
                mutate(draft) {
                    const nextConfig = applyAnnounceLogDetail(draft, detail);
                    replaceConfig(draft, nextConfig);
                },
            });
        },
    };
}
function replaceConfig(draft, nextConfig) {
    for (const key of Object.keys(draft)) {
        delete draft[key];
    }
    Object.assign(draft, structuredClone(nextConfig));
}
//# sourceMappingURL=debug-cli.js.map