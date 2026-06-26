import type { MeshNetwork } from "./types.js";

export async function broadcastToMesh(mesh: MeshNetwork, topic: string, message: string): Promise<void> {
  await mesh.publishToTopic(topic, message);
}

export async function subscribeToMeshTopic(
  mesh: MeshNetwork,
  topic: string,
  handler: (msg: string) => void,
): Promise<() => void> {
  await mesh.subscribeToTopic(topic, handler);
  return () => {
    // Unsubscribe is not directly supported in the current MeshNetwork interface;
    // the handler reference could be stored externally for future cleanup.
  };
}
