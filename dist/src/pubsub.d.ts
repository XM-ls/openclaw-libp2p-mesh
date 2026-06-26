import type { MeshNetwork } from "./types.js";
export declare function broadcastToMesh(mesh: MeshNetwork, topic: string, message: string): Promise<void>;
export declare function subscribeToMeshTopic(mesh: MeshNetwork, topic: string, handler: (msg: string) => void): Promise<() => void>;
