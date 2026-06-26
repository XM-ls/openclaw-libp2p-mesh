export async function sendViaMesh(mesh, peerId, text) {
    if (!peerId || !peerId.trim()) {
        throw new Error("Peer ID is required");
    }
    if (!text || !text.trim()) {
        throw new Error("Message text is required");
    }
    await mesh.sendToPeer(peerId.trim(), text.trim());
}
//# sourceMappingURL=send.js.map