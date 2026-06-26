import { type SetupPrompter } from "./setup-wizard.js";
import type { InstancePeerRecord, LocalPeerLabel } from "./types.js";
export type PeerLabelsWriter = {
    replaceLabels(instanceId: string, labels: LocalPeerLabel[]): Promise<void>;
};
export type RunLabelsWizardOptions = {
    prompter: SetupPrompter;
    instances: InstancePeerRecord[];
    getLabels(instanceId: string): Promise<LocalPeerLabel[]>;
    writer: PeerLabelsWriter;
};
export type LabelsWizardResult = {
    status: "saved";
    instanceId: string;
    labels: LocalPeerLabel[];
    message: string;
} | {
    status: "cancelled";
    message: string;
};
export declare function runLabelsWizard(options: RunLabelsWizardOptions): Promise<LabelsWizardResult>;
