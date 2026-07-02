import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { MeshNetwork } from "./types.js";
export declare const libp2pMeshPlugin: ChannelPlugin;
export declare function createLibp2pMeshChannel(mesh: MeshNetwork): ChannelPlugin;
