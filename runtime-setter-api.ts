import type { MeshNetwork } from "./src/types.js";

let runtime: MeshNetwork | undefined;

export function setLibp2pMeshRuntime(mesh: MeshNetwork | undefined): void {
  runtime = mesh;
}

export function getLibp2pMeshRuntime(): MeshNetwork {
  if (!runtime) {
    throw new Error("libp2p mesh runtime is not initialized");
  }

  return runtime;
}

export function hasLibp2pMeshRuntime(): boolean {
  return runtime !== undefined;
}
