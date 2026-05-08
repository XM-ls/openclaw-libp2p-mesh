import type { MeshNetwork } from "./types.js";

export async function sendViaMesh(mesh: MeshNetwork, peerId: string, text: string): Promise<void> {
  if (!peerId || !peerId.trim()) {
    throw new Error("Peer ID is required");
  }
  if (!text || !text.trim()) {
    throw new Error("Message text is required");
  }
  await mesh.sendToPeer(peerId.trim(), text.trim());
}
