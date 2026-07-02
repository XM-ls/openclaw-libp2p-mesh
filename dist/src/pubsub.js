export async function broadcastToMesh(mesh, topic, message) {
    await mesh.publishToTopic(topic, message);
}
export async function subscribeToMeshTopic(mesh, topic, handler) {
    await mesh.subscribeToTopic(topic, handler);
    return () => {
        // Unsubscribe is not directly supported in the current MeshNetwork interface;
        // the handler reference could be stored externally for future cleanup.
    };
}
//# sourceMappingURL=pubsub.js.map