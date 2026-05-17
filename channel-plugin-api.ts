// Narrow re-export so the bundled channel entry can `plugin.specifier` point
// at a tiny module that doesn't pull in the heavy libp2p stack until the
// plugin is actually activated.

export { libp2pMeshPlugin } from "./src/channel.js";
