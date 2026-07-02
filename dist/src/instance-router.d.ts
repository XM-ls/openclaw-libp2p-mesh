import type { InstanceRouter, InstanceRouterOptions } from "./types.js";
export type RouterLogger = {
    info?: (message: string) => void;
    debug?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
};
export declare function createInstanceRouter(options: InstanceRouterOptions): InstanceRouter;
