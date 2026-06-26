import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SetupCancelledError, runSetupWizard, } from "./setup-wizard.js";
const SETUP_CLI_AFTER_WRITE = {
    mode: "none",
    reason: "libp2p-mesh setup completed; restart manually to apply gateway changes.",
};
export const LIBP2P_MESH_CLI_REGISTRATION = {
    commands: ["libp2p-mesh"],
    descriptors: [
        {
            name: "libp2p-mesh",
            description: "Configure libp2p-mesh plugin.",
            hasSubcommands: true,
        },
    ],
};
export function registerLibp2pMeshSetupCli(api, deps = {}) {
    api.registerCli((ctx) => {
        const root = ctx.program
            .command("libp2p-mesh")
            .description("Configure libp2p-mesh plugin.");
        registerLibp2pMeshSetupCommand(root, api, ctx, deps);
    }, LIBP2P_MESH_CLI_REGISTRATION);
}
export function registerLibp2pMeshSetupCommand(root, api, ctx, deps = {}) {
    root
        .command("setup")
        .description("Run the libp2p-mesh setup wizard.")
        .action(async () => {
        const prompter = (deps.createPrompter?.(ctx) ?? createReadlinePrompter());
        const writer = deps.createWriter?.(api) ?? createOpenClawConfigWriter(api);
        try {
            const result = await runSetupWizard({
                currentConfig: ctx.config,
                prompter,
                writer,
            });
            prompter.print(result.message);
        }
        finally {
            prompter.close?.();
        }
    });
}
function createOpenClawConfigWriter(api) {
    return {
        async write(nextConfig) {
            await api.runtime.config.mutateConfigFile({
                afterWrite: SETUP_CLI_AFTER_WRITE,
                mutate(draft) {
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
export function createReadlinePrompter() {
    const readline = createInterface({ input, output });
    return {
        async confirm(message, defaultValue = false) {
            const suffix = defaultValue ? "Y/n" : "y/N";
            const answer = await ask(readline, `${message} (${suffix}) `);
            const normalized = answer.trim().toLowerCase();
            if (!normalized) {
                return defaultValue;
            }
            return normalized === "y" || normalized === "yes";
        },
        async select(message, choices) {
            output.write(`${message}\n`);
            choices.forEach((choice, index) => {
                output.write(`  ${index + 1}. ${choice.label}\n`);
            });
            while (true) {
                const answer = await ask(readline, "Choose an option: ");
                const selectedIndex = Number.parseInt(answer.trim(), 10) - 1;
                const selected = choices[selectedIndex];
                if (selected) {
                    return selected.value;
                }
                output.write("Please choose one of the listed options.\n");
            }
        },
        async input(message, options) {
            while (true) {
                const defaultSuffix = options?.defaultValue ? ` (${options.defaultValue})` : "";
                const answer = await ask(readline, `${message}${defaultSuffix}: `);
                const value = answer.trim() || options?.defaultValue || "";
                if (value || !options?.required) {
                    return value;
                }
                output.write("A value is required.\n");
            }
        },
        print(message) {
            output.write(`${message}\n`);
        },
        close() {
            readline.close();
        },
    };
}
async function ask(readline, query) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    readline.once("SIGINT", abort);
    try {
        return await readline.question(query, { signal: controller.signal });
    }
    catch (error) {
        if (isCancellationError(error)) {
            throw new SetupCancelledError();
        }
        throw error;
    }
    finally {
        readline.off("SIGINT", abort);
    }
}
function isCancellationError(error) {
    return error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
}
//# sourceMappingURL=setup-cli.js.map