import test from "node:test";
import assert from "node:assert/strict";

import { registerLibp2pMeshWithDeps } from "../src/plugin.js";
import type { InstanceRouter, MeshNetwork, P2PMessage } from "../src/types.js";

type ServiceRegistration = {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
};

function makeMesh(calls: string[]): MeshNetwork {
  const messageHandlers = new Set<(msg: P2PMessage) => void>();

  return {
    async start() {
      calls.push("mesh.start");
      for (const handler of messageHandlers) {
        handler({
          id: "direct-before-start-complete",
          type: "direct",
          from: "remote-peer",
          payload: "hello before start completes",
          timestamp: 1,
        });
      }
    },
    async stop() {
      calls.push("mesh.stop");
    },
    async sendToPeer() {},
    async sendStructuredMessage() {},
    onMessage(handler) {
      calls.push("inbound.attach");
      messageHandlers.add(handler);
      return () => {
        calls.push("inbound.unsubscribe");
        messageHandlers.delete(handler);
      };
    },
    onPeerConnect() {
      return () => {};
    },
    onPeerDisconnect() {
      return () => {};
    },
    async publishToTopic() {},
    async subscribeToTopic() {},
    getLocalPeerId() {
      return "local-peer";
    },
    getConnectedPeers() {
      return [];
    },
    getMultiaddrs() {
      return [];
    },
    async dial() {},
    getInstanceIdentity() {
      return {
        id: "local-instance",
        name: "local",
        pubkey: "local-pubkey",
        binding: "local-binding",
        bindingComponents: {
          username: "user",
          hostname: "host",
          platform: "test",
        },
        createdAt: 1,
      };
    },
    getNATStatus() {
      return {
        enabled: {
          identify: false,
          autoNAT: false,
          upnp: false,
          circuitRelay: false,
          circuitRelayServer: false,
          dcutr: false,
        },
        reservedRelays: [],
        hasRelayedListenAddr: false,
      };
    },
  };
}

function makeRouter(calls: string[]): InstanceRouter {
  return {
    attachHandlers() {
      calls.push("router.attachHandlers");
    },
    async announceToConnectedPeers() {
      calls.push("router.announceToConnectedPeers");
    },
    async start() {
      calls.push("router.start");
    },
    async stop() {
      calls.push("router.stop");
    },
    async handleMessage() {},
    async announceToPeer() {},
    async listInstances() {
      return [];
    },
    async resolveInstance() {
      return undefined;
    },
    async sendInstanceMessage(instanceId: string) {
      return {
        sent: false,
        delivered: false,
        toInstanceId: instanceId,
        toPeerId: "",
      };
    },
    async sendUserAttributeMessage() {
      return {
        matched: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
      };
    },
  };
}

function makeApi(calls: string[]) {
  const services: ServiceRegistration[] = [];
  const infoLogs: string[] = [];

  const api = {
    id: "libp2p-mesh",
    name: "libp2p-mesh",
    source: "test",
    registrationMode: "full",
    config: {},
    pluginConfig: {},
    logger: {
      debug() {},
      info(message: string) {
        infoLogs.push(message);
      },
      warn() {},
      error() {},
    },
    runtime: {
      config: {
        current: () => ({}),
        async mutateConfigFile() {
          return { result: undefined, nextConfig: {} };
        },
      },
      channel: {
        outbound: {
          loadAdapter() {
            return undefined;
          },
        },
      },
    },
    registerCli() {},
    registerService(service: ServiceRegistration) {
      services.push(service);
    },
    registerChannel() {},
    registerTool() {},
    registerHook() {},
  };

  return { api: api as never, services, infoLogs, calls };
}

test("service registers router and inbound handlers before mesh startup", async () => {
  const calls: string[] = [];
  const { api, services, infoLogs } = makeApi(calls);

  registerLibp2pMeshWithDeps(api, {
    createMeshNetwork: () => makeMesh(calls),
    createInstanceRouter: () => makeRouter(calls),
  });

  assert.equal(services.length, 1);
  await services[0].start();

  assert.deepEqual(calls.slice(0, 4), [
    "router.attachHandlers",
    "inbound.attach",
    "mesh.start",
    "router.announceToConnectedPeers",
  ]);
  assert.ok(
    infoLogs.some((message) => message.includes("Direct message from remote-peer")),
    "expected direct inbound handler to receive messages during mesh.start",
  );

  await services[0].start();
  assert.equal(
    calls.filter((call) => call === "router.attachHandlers").length,
    1,
    "duplicate service start should not attach router handlers again",
  );
  assert.equal(
    calls.filter((call) => call === "inbound.attach").length,
    1,
    "duplicate service start should not attach inbound handler again",
  );

  await services[0].stop();
  assert.ok(calls.includes("inbound.unsubscribe"));
  assert.ok(calls.includes("router.stop"));
  assert.ok(calls.includes("mesh.stop"));
});

test("service cleans inbound handlers after mesh startup failure before retry", async () => {
  const calls: string[] = [];
  const { api, services } = makeApi(calls);
  let startAttempts = 0;

  registerLibp2pMeshWithDeps(api, {
    createMeshNetwork: () => ({
      ...makeMesh(calls),
      async start() {
        calls.push("mesh.start");
        startAttempts++;
        if (startAttempts === 1) {
          throw new Error("startup failed");
        }
      },
    }),
    createInstanceRouter: () => makeRouter(calls),
  });

  assert.equal(services.length, 1);
  await assert.rejects(services[0].start(), /startup failed/);
  assert.deepEqual(calls.slice(0, 5), [
    "router.attachHandlers",
    "inbound.attach",
    "mesh.start",
    "inbound.unsubscribe",
    "router.stop",
  ]);

  await services[0].start();
  assert.equal(
    calls.filter((call) => call === "inbound.attach").length,
    2,
    "retry after failed startup should attach one fresh inbound handler",
  );
  assert.equal(
    calls.filter((call) => call === "inbound.unsubscribe").length,
    1,
    "failed startup should clean the stale inbound handler before retry",
  );

  await services[0].stop();
  assert.equal(
    calls.filter((call) => call === "inbound.unsubscribe").length,
    2,
    "stop should clean the active inbound handler from the successful retry",
  );
});

test("concurrent service starts share one startup and handler registration", async () => {
  const calls: string[] = [];
  const { api, services } = makeApi(calls);
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });

  registerLibp2pMeshWithDeps(api, {
    createMeshNetwork: () => ({
      ...makeMesh(calls),
      async start() {
        calls.push("mesh.start");
        await startGate;
      },
    }),
    createInstanceRouter: () => makeRouter(calls),
  });

  assert.equal(services.length, 1);
  const firstStart = services[0].start();
  const secondStart = services[0].start();
  releaseStart();
  await Promise.all([firstStart, secondStart]);

  assert.equal(
    calls.filter((call) => call === "router.attachHandlers").length,
    1,
    "concurrent starts should attach router handlers once",
  );
  assert.equal(
    calls.filter((call) => call === "inbound.attach").length,
    1,
    "concurrent starts should attach inbound handlers once",
  );
  assert.equal(
    calls.filter((call) => call === "mesh.start").length,
    1,
    "concurrent starts should share one mesh startup",
  );
  assert.equal(
    calls.filter((call) => call === "router.announceToConnectedPeers").length,
    1,
    "concurrent starts should announce once after mesh startup",
  );

  await services[0].stop();
});
