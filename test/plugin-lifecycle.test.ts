import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { DEFAULT_DELIVERY_ACK_TIMEOUT_MS } from "../src/setup-config.js";
import type {
  InstancePeerRecord,
  InstanceRouter,
  InstanceRouterOptions,
  MeshConfig,
  MeshNetwork,
  P2PMessage,
  UserAttributeMatch,
  UserAttributeMessageOptions,
  UserAttributeMessageResult,
} from "../src/types.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/runtime-setter-api.js")) {
      return {
        url: [
          "data:text/javascript,",
          encodeURIComponent(
            [
              "export function setLibp2pMeshRuntime() {}",
              "export function getLibp2pMeshRuntime() { throw new Error('runtime unavailable in lifecycle test'); }",
              "export function hasLibp2pMeshRuntime() { return false; }",
            ].join("\n"),
          ),
        ].join(""),
        shortCircuit: true,
      };
    }

    return nextResolve(specifier, context);
  },
});

async function loadPlugin() {
  return import("../src/plugin.js");
}

function createMeshStub(): MeshNetwork {
  return {
    async start() {},
    async stop() {},
    async sendToPeer() {},
    async sendStructuredMessage() {},
    onMessage() {
      return () => {};
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
      return "peer-local";
    },
    getConnectedPeers() {
      return [];
    },
    getMultiaddrs() {
      return [];
    },
    async dial() {},
    getInstanceIdentity() {
      return undefined;
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

function createRouterStub(): InstanceRouter {
  return {
    attachHandlers() {},
    async announceToConnectedPeers() {},
    async start() {},
    async stop() {},
    async handleMessage(_msg: P2PMessage) {},
    async announceToPeer() {},
    enablePublicAttributeRefresh() {},
    async refreshPublicAttributes() {},
    async listInstances(): Promise<InstancePeerRecord[]> {
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
    async sendUserAttributeMessage(
      _match: UserAttributeMatch,
      _message: string,
      _options?: UserAttributeMessageOptions,
    ): Promise<UserAttributeMessageResult> {
      return {
        scope: "public",
        matched: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
      };
    },
  };
}

function createApi(pluginConfig?: MeshConfig): OpenClawPluginApi {
  return {
    pluginConfig,
    config: {},
    runtime: {},
    logger: {},
    registerService() {},
    registerChannel() {},
    registerTool() {},
    registerHook() {},
    registerCli() {},
  } as unknown as OpenClawPluginApi;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

test("registerLibp2pMeshWithDeps passes defaulted config to mesh and router when pluginConfig is undefined", async () => {
  const { registerLibp2pMeshWithDeps } = await loadPlugin();
  const mesh = createMeshStub();
  let meshConfig: MeshConfig | undefined;
  let routerConfig: MeshConfig | undefined;

  registerLibp2pMeshWithDeps(createApi(undefined), {
    createMeshNetwork(options) {
      meshConfig = options.config;
      return mesh;
    },
    createInstanceRouter(options: InstanceRouterOptions) {
      routerConfig = options.config;
      return createRouterStub();
    },
    async autoInstallAgentPrompt() {},
  });

  assert.deepEqual(meshConfig, {
    discovery: "mdns",
    enableNATTraversal: true,
    enableDHT: true,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
  assert.deepEqual(routerConfig, meshConfig);
});

test("registerLibp2pMeshWithDeps preserves explicit config while filling missing defaults", async () => {
  const { registerLibp2pMeshWithDeps } = await loadPlugin();
  const mesh = createMeshStub();
  const explicitConfig: MeshConfig = {
    discovery: "bootstrap",
    bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Example"],
    enableNATTraversal: false,
    inboundChannel: "telegram",
    inboundTarget: "chat:123",
  };
  let meshConfig: MeshConfig | undefined;
  let routerConfig: MeshConfig | undefined;

  registerLibp2pMeshWithDeps(createApi(explicitConfig), {
    createMeshNetwork(options) {
      meshConfig = options.config;
      return mesh;
    },
    createInstanceRouter(options: InstanceRouterOptions) {
      routerConfig = options.config;
      return createRouterStub();
    },
    async autoInstallAgentPrompt() {},
  });

  assert.deepEqual(meshConfig, {
    discovery: "bootstrap",
    enableNATTraversal: false,
    enableDHT: true,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
    bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Example"],
    inboundChannel: "telegram",
    inboundTarget: "chat:123",
  });
  assert.deepEqual(routerConfig, meshConfig);
});

test("registerLibp2pMeshWithDeps starts automatic prompt installation without awaiting it and passes api.logger", async () => {
  const { registerLibp2pMeshWithDeps } = await loadPlugin();
  const logger = { info() {}, warn() {} };
  let promptStarted = false;
  let promptLogger: unknown;
  let resolvePrompt: (() => void) | undefined;

  registerLibp2pMeshWithDeps(
    {
      ...createApi(undefined),
      logger,
    } as OpenClawPluginApi,
    {
      createMeshNetwork() {
        return createMeshStub();
      },
      createInstanceRouter() {
        return createRouterStub();
      },
      autoInstallAgentPrompt(options) {
        promptStarted = true;
        promptLogger = options?.logger;
        return new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        });
      },
    },
  );

  assert.equal(promptStarted, true);
  assert.equal(promptLogger, logger);
  resolvePrompt?.();
});

test("registerLibp2pMeshWithDeps catches rejecting automatic prompt installation and safely warns", async () => {
  const { registerLibp2pMeshWithDeps } = await loadPlugin();
  const warnings: string[] = [];

  registerLibp2pMeshWithDeps(
    {
      ...createApi(undefined),
      logger: {
        warn(message) {
          warnings.push(message);
          throw new Error("logger unavailable");
        },
      },
    } as OpenClawPluginApi,
    {
      createMeshNetwork() {
        return createMeshStub();
      },
      createInstanceRouter() {
        return createRouterStub();
      },
      async autoInstallAgentPrompt() {
        throw new Error("prompt failed");
      },
    },
  );

  await flushMicrotasks();

  assert.deepEqual(warnings, [
    "[libp2p-mesh] Failed to auto-install agent prompt: Error: prompt failed",
  ]);
});
