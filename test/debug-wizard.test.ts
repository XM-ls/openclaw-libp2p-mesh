import test from "node:test";
import assert from "node:assert/strict";

import { runDebugWizard } from "../src/debug-wizard.js";
import { SetupCancelledError, type SetupPrompter } from "../src/setup-wizard.js";
import type { AnnounceLogDetail } from "../src/types.js";

function makePrompter(script: Array<string | boolean | Error>, printed: string[] = []): SetupPrompter {
  const values = [...script];
  const next = () => {
    const value = values.shift();
    if (value instanceof Error) {
      throw value;
    }
    return value;
  };

  return {
    async confirm() {
      return next() as boolean;
    },
    async select() {
      return next() as string;
    },
    async input() {
      return next() as string;
    },
    print(message) {
      printed.push(message);
    },
  };
}

test("debug wizard saves selected summary mode and tells user to restart gateway", async () => {
  const printed: string[] = [];
  const writes: AnnounceLogDetail[] = [];

  const result = await runDebugWizard({
    prompter: makePrompter(["summary"], printed),
    current: "off",
    writer: {
      async saveAnnounceLogDetail(detail) {
        writes.push(detail);
      },
    },
  });

  assert.deepEqual(writes, ["summary"]);
  assert.deepEqual(result, {
    status: "saved",
    announceLogDetail: "summary",
    message: "Debug config updated.\n\nRestart the gateway to apply changes:\nopenclaw gateway restart",
  });
  assert.match(printed.join("\n"), /Current announceLogDetail: off/);
});

test("debug wizard requires confirmation before saving payload logs", async () => {
  const writes: AnnounceLogDetail[] = [];

  const result = await runDebugWizard({
    prompter: makePrompter(["payload", true]),
    current: "summary",
    writer: {
      async saveAnnounceLogDetail(detail) {
        writes.push(detail);
      },
    },
  });

  assert.deepEqual(writes, ["payload"]);
  assert.equal(result.status, "saved");
  assert.equal(result.status === "saved" ? result.announceLogDetail : undefined, "payload");
});

test("debug wizard does not write payload when confirmation is rejected", async () => {
  const writes: AnnounceLogDetail[] = [];

  const result = await runDebugWizard({
    prompter: makePrompter(["payload", false]),
    current: "summary",
    writer: {
      async saveAnnounceLogDetail(detail) {
        writes.push(detail);
      },
    },
  });

  assert.deepEqual(writes, []);
  assert.deepEqual(result, {
    status: "cancelled",
    message: "Debug configuration cancelled. No changes were written.",
  });
});

test("debug wizard treats cancellation as no write", async () => {
  const writes: AnnounceLogDetail[] = [];

  const result = await runDebugWizard({
    prompter: makePrompter([new SetupCancelledError()]),
    current: "summary",
    writer: {
      async saveAnnounceLogDetail(detail) {
        writes.push(detail);
      },
    },
  });

  assert.deepEqual(writes, []);
  assert.deepEqual(result, {
    status: "cancelled",
    message: "Debug configuration cancelled. No changes were written.",
  });
});
