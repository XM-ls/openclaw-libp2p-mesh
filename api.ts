export { createMeshNetwork } from "./src/mesh.js";
export { createInstancePeerStore } from "./src/instance-peer-store.js";
export { createInstanceRouter } from "./src/instance-router.js";
export type {
  DeliveryAckPayload,
  DeliveryTargetResult,
  InboundDeliveryAdapter,
  InboundDeliveryRequest,
  InboundDeliveryResult,
  InboundTargetConfig,
  InstanceAnnouncePayload,
  InstanceIdentity,
  InstancePeerRecord,
  InstancePeerStore,
  InstancePeerTable,
  InstanceRouter,
  MeshConfig,
  MeshNetwork,
  P2PMessage,
  P2PMessageType,
  UserMessagePayload,
} from "./src/types.js";
