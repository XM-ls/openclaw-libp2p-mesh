import { SetupCancelledError, type SetupPrompter } from "./setup-wizard.js";
import type { AnnounceLogDetail } from "./types.js";

const CANCELLED_MESSAGE = "Debug configuration cancelled. No changes were written.";
const SAVED_MESSAGE = "Debug config updated.\n\nRestart the gateway to apply changes:\nopenclaw gateway restart";

export type DebugPromptChoice = AnnounceLogDetail | "cancel";

export type RunDebugWizardOptions = {
  prompter: SetupPrompter;
  current: AnnounceLogDetail;
  writer: {
    saveAnnounceLogDetail(detail: AnnounceLogDetail): Promise<void>;
  };
};

export type DebugWizardResult =
  | { status: "saved"; announceLogDetail: AnnounceLogDetail; message: string }
  | { status: "cancelled"; message: string };

export async function runDebugWizard(options: RunDebugWizardOptions): Promise<DebugWizardResult> {
  try {
    options.prompter.print(`Current announceLogDetail: ${options.current}`);
    const selected = await options.prompter.select<DebugPromptChoice>("Set announceLogDetail:", [
      { label: "summary: log peer, instance, address and attribute counts", value: "summary" },
      { label: "off: disable announce summary/payload logs", value: "off" },
      { label: "payload: log full announce JSON", value: "payload" },
      { label: "Cancel", value: "cancel" },
    ]);

    if (selected === "cancel") {
      return cancelledResult();
    }

    if (selected === "payload") {
      const confirmed = await options.prompter.confirm(
        "Full announce payload logs may include userPublicAttributes, multiaddrs, pubkey and instance identity. Enable payload logs?",
        false,
      );
      if (!confirmed) {
        return cancelledResult();
      }
    }

    await options.writer.saveAnnounceLogDetail(selected);
    return {
      status: "saved",
      announceLogDetail: selected,
      message: SAVED_MESSAGE,
    };
  } catch (error) {
    if (error instanceof SetupCancelledError) {
      return cancelledResult();
    }
    throw error;
  }
}

function cancelledResult(): DebugWizardResult {
  return {
    status: "cancelled",
    message: CANCELLED_MESSAGE,
  };
}
