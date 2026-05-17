// Narrow setter for the libp2p-mesh runtime. The bundled channel entry needs
// a static `libp2pMeshPlugin` export to satisfy openclaw's bundled-channel
// contract; the channel itself however needs the mesh runtime, which is
// constructed inside registerFull(). We bridge the two via this module-level
// holder: registerFull() calls setLibp2pMeshRuntime(mesh) after starting the
// service, and channel.ts reads from getLibp2pMeshRuntime() when sending.

import type { MeshNetwork } from "./src/types.js";

let _runtime: MeshNetwork | null = null;

export function setLibp2pMeshRuntime(mesh: MeshNetwork): void {
  _runtime = mesh;
}

export function getLibp2pMeshRuntime(): MeshNetwork {
  if (!_runtime) {
    throw new Error(
      "libp2p-mesh: runtime not initialized — registerFull() must call setLibp2pMeshRuntime() before any channel call",
    );
  }
  return _runtime;
}

export function hasLibp2pMeshRuntime(): boolean {
  return _runtime !== null;
}
