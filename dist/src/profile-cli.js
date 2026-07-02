import { createReadlinePrompter, LIBP2P_MESH_CLI_REGISTRATION, registerLibp2pMeshSetupCommand, } from "./setup-cli.js";
import { registerLibp2pMeshDebugCommand } from "./debug-cli.js";
import { createInstancePeerStore } from "./instance-peer-store.js";
import { runLabelsWizard } from "./labels-wizard.js";
import { createPeerLabelStore } from "./peer-label-store.js";
import { registerLibp2pMeshPromptCommand } from "./prompt-cli.js";
import { runProfileWizard } from "./profile-wizard.js";
import { createUserMdAttributeSource } from "./user-md-attributes.js";
import { createUserProfileStore } from "./user-profile-store.js";
export function registerLibp2pMeshCli(api, deps = {}) {
    api.registerCli((ctx) => {
        const root = ctx.program
            .command("libp2p-mesh")
            .description("Configure libp2p-mesh plugin.");
        registerLibp2pMeshSetupCommand(root, api, ctx, deps.setup);
        registerLibp2pMeshProfileCommand(root, api, ctx, deps.profile);
        registerLibp2pMeshLabelsCommand(root, api, ctx, deps.labels);
        registerLibp2pMeshDebugCommand(root, api, ctx, deps.debug);
        registerLibp2pMeshPromptCommand(root, ctx, deps.prompt);
    }, LIBP2P_MESH_CLI_REGISTRATION);
}
export function registerLibp2pMeshProfileCli(api, deps = {}) {
    api.registerCli((ctx) => {
        const root = ctx.program
            .command("libp2p-mesh")
            .description("Configure libp2p-mesh plugin.");
        registerLibp2pMeshProfileCommand(root, api, ctx, deps);
    }, LIBP2P_MESH_CLI_REGISTRATION);
}
export function registerLibp2pMeshProfileCommand(root, api, ctx, deps = {}) {
    root
        .command("profile")
        .description("Manage libp2p-mesh public profile attributes.")
        .action(async () => {
        const prompter = (deps.createPrompter?.(ctx) ?? createReadlinePrompter());
        const profileStore = deps.createProfileStore?.(api) ?? createUserProfileStore({ logger: api.logger });
        const userMdAttributeSource = deps.createUserMdAttributeSource?.(api) ?? createUserMdAttributeSource({ logger: api.logger });
        try {
            const result = await runProfileWizard({
                prompter,
                readOnlyTags: await userMdAttributeSource.loadTags(),
                profileAttributes: await profileStore.listAttributes(),
                writer: {
                    async replaceAttributes(attributes) {
                        await profileStore.replaceAttributes(attributes);
                        await deps.afterProfileSave?.();
                    },
                },
            });
            prompter.print(result.message);
        }
        finally {
            prompter.close?.();
        }
    });
}
export function registerLibp2pMeshLabelsCommand(root, api, ctx, deps = {}) {
    root
        .command("labels")
        .description("Manage local labels for discovered libp2p-mesh instances.")
        .action(async () => {
        const prompter = (deps.createPrompter?.(ctx) ?? createReadlinePrompter());
        const peerStore = deps.createPeerStore?.(api) ?? createInstancePeerStore({ logger: api.logger });
        const peerLabelStore = deps.createPeerLabelStore?.(api) ?? createPeerLabelStore({ logger: api.logger });
        try {
            const result = await runLabelsWizard({
                prompter,
                instances: await peerStore.list(),
                async getLabels(instanceId) {
                    return peerLabelStore.listRawLabels(instanceId);
                },
                writer: {
                    async replaceLabels(instanceId, labels) {
                        await peerLabelStore.replaceLabels(instanceId, labels);
                    },
                },
            });
            prompter.print(result.message);
        }
        finally {
            prompter.close?.();
        }
    });
}
//# sourceMappingURL=profile-cli.js.map