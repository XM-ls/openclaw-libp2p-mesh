let runtime;
export function setLibp2pMeshRuntime(mesh) {
    runtime = mesh;
}
export function getLibp2pMeshRuntime() {
    if (!runtime) {
        throw new Error("libp2p mesh runtime is not initialized");
    }
    return runtime;
}
export function hasLibp2pMeshRuntime() {
    return runtime !== undefined;
}
//# sourceMappingURL=runtime-setter-api.js.map