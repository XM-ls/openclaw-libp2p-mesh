import test from "node:test";
import assert from "node:assert/strict";

import { SetupCancelledError, type SetupPrompter } from "../src/setup-wizard.js";
import { runProfileWizard, type UserProfileWriter } from "../src/profile-wizard.js";
import type { UserPublicAttribute } from "../src/types.js";

function makePrompter(script: Array<string | boolean>, printed: string[] = []): SetupPrompter {
  const values = [...script];
  return {
    async confirm() {
      const value = values.shift();
      assert.equal(typeof value, "boolean");
      return value;
    },
    async select() {
      const value = values.shift();
      assert.equal(typeof value, "string");
      return value;
    },
    async input() {
      const value = values.shift();
      assert.equal(typeof value, "string");
      return value;
    },
    print(message) {
      printed.push(message);
    },
  };
}

function makeWriter() {
  const writes: UserPublicAttribute[][] = [];
  const writer: UserProfileWriter = {
    async replaceAttributes(attributes) {
      writes.push(attributes);
    },
  };
  return { writer, writes };
}

const userMdTag: UserPublicAttribute = {
  kind: "tag",
  value: "Rust",
  label: "Rust",
  source: "USER.md",
};

test("adds a structured profile attribute after preview confirmation", async () => {
  const printed: string[] = [];
  const { writer, writes } = makeWriter();
  const result = await runProfileWizard({
    prompter: makePrompter(["add-attribute", "group", "OpenClaw", "preview-finish", true], printed),
    readOnlyTags: [userMdTag],
    profileAttributes: [],
    writer,
  });

  assert.equal(result.status, "saved");
  assert.equal(result.message, "Profile attributes saved.\n\nRestart the gateway to broadcast updated attributes.");
  assert.deepEqual(writes[0], [
    {
      kind: "structured",
      key: "group",
      value: "OpenClaw",
      label: "group: OpenClaw",
      source: "profile",
    },
  ]);
  assert.match(printed.join("\n"), /Read-only USER\.md tags/);
  assert.match(printed.join("\n"), /Rust/);
});

test("edits an existing structured profile attribute", async () => {
  const { writer, writes } = makeWriter();
  const result = await runProfileWizard({
    prompter: makePrompter(["edit-attribute", "attribute-index-0", "skill", "TypeScript", "preview-finish", true]),
    readOnlyTags: [],
    profileAttributes: [
      {
        kind: "structured",
        key: "role",
        value: "reviewer",
        label: "role: reviewer",
        source: "profile",
      },
    ],
    writer,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(writes[0], [
    {
      kind: "structured",
      key: "skill",
      value: "TypeScript",
      label: "skill: TypeScript",
      source: "profile",
    },
  ]);
});

test("removes a structured profile attribute", async () => {
  const { writer, writes } = makeWriter();
  const result = await runProfileWizard({
    prompter: makePrompter(["remove-attribute", "attribute-index-0", "preview-finish", true]),
    readOnlyTags: [],
    profileAttributes: [
      {
        kind: "structured",
        key: "role",
        value: "reviewer",
        label: "role: reviewer",
        source: "profile",
      },
      {
        kind: "structured",
        key: "project",
        value: "mesh",
        label: "project: mesh",
        source: "profile",
      },
    ],
    writer,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(writes[0], [
    {
      kind: "structured",
      key: "project",
      value: "mesh",
      label: "project: mesh",
      source: "profile",
    },
  ]);
});

test("displays USER.md tags as read-only and never writes them to profile", async () => {
  const printed: string[] = [];
  const { writer, writes } = makeWriter();
  const result = await runProfileWizard({
    prompter: makePrompter(["preview-finish", true], printed),
    readOnlyTags: [userMdTag],
    profileAttributes: [],
    writer,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(writes[0], []);
  assert.match(printed.join("\n"), /Read-only USER\.md tags/);
  assert.match(printed.join("\n"), /Rust/);
});

test("custom category prompts for a custom key", async () => {
  const { writer, writes } = makeWriter();
  const result = await runProfileWizard({
    prompter: makePrompter(["add-attribute", "custom", "team", "core", "preview-finish", true]),
    readOnlyTags: [],
    profileAttributes: [],
    writer,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(writes[0], [
    {
      kind: "structured",
      key: "team",
      value: "core",
      label: "team: core",
      source: "profile",
    },
  ]);
});

test("preview rejection cancels without writing", async () => {
  const { writer, writes } = makeWriter();
  const result = await runProfileWizard({
    prompter: makePrompter(["add-attribute", "group", "OpenClaw", "preview-finish", false]),
    readOnlyTags: [],
    profileAttributes: [],
    writer,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "Profile update cancelled. No changes were written.");
  assert.equal(writes.length, 0);
});

test("Ctrl+C cancellation exits without writing", async () => {
  const { writer, writes } = makeWriter();
  const result = await runProfileWizard({
    prompter: {
      async confirm() {
        throw new SetupCancelledError();
      },
      async select() {
        throw new SetupCancelledError();
      },
      async input() {
        throw new SetupCancelledError();
      },
      print() {},
    },
    readOnlyTags: [],
    profileAttributes: [],
    writer,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "Profile update cancelled. No changes were written.");
  assert.equal(writes.length, 0);
});
