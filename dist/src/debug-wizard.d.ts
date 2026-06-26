import { type SetupPrompter } from "./setup-wizard.js";
import type { AnnounceLogDetail } from "./types.js";
export type DebugPromptChoice = AnnounceLogDetail | "cancel";
export type RunDebugWizardOptions = {
    prompter: SetupPrompter;
    current: AnnounceLogDetail;
    writer: {
        saveAnnounceLogDetail(detail: AnnounceLogDetail): Promise<void>;
    };
};
export type DebugWizardResult = {
    status: "saved";
    announceLogDetail: AnnounceLogDetail;
    message: string;
} | {
    status: "cancelled";
    message: string;
};
export declare function runDebugWizard(options: RunDebugWizardOptions): Promise<DebugWizardResult>;
