import { type SetupPrompter } from "./setup-wizard.js";
import type { UserPublicAttribute } from "./types.js";
export type UserProfileWriter = {
    replaceAttributes(attributes: UserPublicAttribute[]): Promise<void>;
};
export type RunProfileWizardOptions = {
    prompter: SetupPrompter;
    readOnlyTags: UserPublicAttribute[];
    profileAttributes: UserPublicAttribute[];
    writer: UserProfileWriter;
};
export type ProfileWizardResult = {
    status: "saved";
    attributes: UserPublicAttribute[];
    message: string;
} | {
    status: "cancelled";
    message: string;
};
export declare function runProfileWizard(options: RunProfileWizardOptions): Promise<ProfileWizardResult>;
