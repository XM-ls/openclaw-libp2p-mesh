import test from "node:test";
import assert from "node:assert/strict";

import { runLabelsWizard, type PeerLabelsWriter } from "../src/labels-wizard.js";
import { SetupCancelledError, type SetupPrompter } from "../src/setup-wizard.js";
import type { InstancePeerRecord, LocalPeerLabel } from "../src/types.js";

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
  const writes: Array<{ instanceId: string; labels: LocalPeerLabel[] }> = [];
  const writer: PeerLabelsWriter = {
    async replaceLabels(instanceId, labels) {
      writes.push({ instanceId, labels });
    },
  };
  return { writer, writes };
}

function makeRecord(
  instanceId: string,
  peerId: string,
  fields: Partial<Pick<InstancePeerRecord, "instanceName" | "userPublicAttributes">> = {},
): InstancePeerRecord {
  return {
    instanceId,
    peerId,
    instanceName: fields.instanceName,
    multiaddrs: [],
    userPublicAttributes: fields.userPublicAttributes,
    lastSeenAt: 1,
    lastAnnouncedAt: 1,
    source: "announce",
  };
}

const aliceRecord = makeRecord("alice@abc.111", "peer-alice", {
  instanceName: "Alice laptop",
  userPublicAttributes: [
    {
      kind: "structured",
      key: "group",
      value: "Research",
      label: "group: Research",
      source: "profile",
    },
  ],
});

const bobRecord = makeRecord("bob@abc.222", "peer-bob", {
  instanceName: "Bob workstation",
  userPublicAttributes: [
    {
      kind: "structured",
      key: "project",
      value: "Mesh",
      label: "project: Mesh",
      source: "profile",
    },
  ],
});

test("adds a local label for a selected discovered instance", async () => {
  const { writer, writes } = makeWriter();
  const printed: string[] = [];
  const result = await runLabelsWizard({
    prompter: makePrompter(["instance-index-0", "add-label", "group", "实验室", "save-finish"], printed),
    instances: [aliceRecord],
    async getLabels() {
      return [];
    },
    writer,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(writes, [{ instanceId: "alice@abc.111", labels: [{ key: "group", value: "实验室" }] }]);
  assert.match(printed.join("\n"), /Discovered instances/);
  assert.match(printed.join("\n"), /public attributes/);
});

test("cancels without writing when there are no discovered instances", async () => {
  const { writer, writes } = makeWriter();
  const printed: string[] = [];
  const result = await runLabelsWizard({
    prompter: makePrompter([], printed),
    instances: [],
    async getLabels() {
      return [];
    },
    writer,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "Local labels update cancelled. No changes were written.");
  assert.equal(writes.length, 0);
  assert.match(printed.join("\n"), /No discovered instances/);
});

test("edits an existing local label", async () => {
  const { writer, writes } = makeWriter();
  const result = await runLabelsWizard({
    prompter: makePrompter(["instance-index-0", "edit-label", "label-index-0", "skill", "TypeScript", "save-finish"]),
    instances: [aliceRecord],
    async getLabels() {
      return [{ key: "role", value: "reviewer" }];
    },
    writer,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(writes, [{ instanceId: "alice@abc.111", labels: [{ key: "skill", value: "TypeScript" }] }]);
});

test("removes an existing local label", async () => {
  const { writer, writes } = makeWriter();
  const result = await runLabelsWizard({
    prompter: makePrompter(["instance-index-0", "remove-label", "label-index-0", "save-finish"]),
    instances: [aliceRecord],
    async getLabels() {
      return [
        { key: "role", value: "reviewer" },
        { key: "project", value: "mesh" },
      ];
    },
    writer,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(writes, [{ instanceId: "alice@abc.111", labels: [{ key: "project", value: "mesh" }] }]);
});

test("custom label prompts for custom key", async () => {
  const { writer, writes } = makeWriter();
  const result = await runLabelsWizard({
    prompter: makePrompter(["instance-index-0", "add-label", "custom", "Team", "core", "save-finish"]),
    instances: [aliceRecord],
    async getLabels() {
      return [];
    },
    writer,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(writes, [{ instanceId: "alice@abc.111", labels: [{ key: "team", value: "core" }] }]);
});

test("chooses another discovered instance and saves only its reloaded labels", async () => {
  const { writer, writes } = makeWriter();
  const getLabelsCalls: string[] = [];
  const result = await runLabelsWizard({
    prompter: makePrompter(["instance-index-0", "choose-instance", "instance-index-1", "save-finish"]),
    instances: [aliceRecord, bobRecord],
    async getLabels(instanceId) {
      getLabelsCalls.push(instanceId);
      return instanceId === "bob@abc.222"
        ? [{ key: "project", value: "mesh" }]
        : [{ key: "role", value: "reviewer" }];
    },
    writer,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(getLabelsCalls, ["alice@abc.111", "bob@abc.222"]);
  assert.deepEqual(writes, [{ instanceId: "bob@abc.222", labels: [{ key: "project", value: "mesh" }] }]);
});

test("Ctrl+C cancellation exits without writing", async () => {
  const { writer, writes } = makeWriter();
  const result = await runLabelsWizard({
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
    instances: [aliceRecord],
    async getLabels() {
      return [{ key: "role", value: "reviewer" }];
    },
    writer,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "Local labels update cancelled. No changes were written.");
  assert.equal(writes.length, 0);
});
