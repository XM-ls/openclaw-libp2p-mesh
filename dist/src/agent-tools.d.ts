import type { DeliveryTargetResult, InstancePeerRecord, InstanceRouter, LocalPeerLabelAttribute, MeshNetwork, PeerLabelStore } from "./types.js";
type BuildP2PToolsOptions = {
    peerLabelStore?: Pick<PeerLabelStore, "listLabels">;
};
type SendUserAttributeToolParams = {
    selector?: unknown;
    match?: {
        kind?: unknown;
        key?: unknown;
        value?: unknown;
    };
    message?: unknown;
    dryRun?: unknown;
    scope?: unknown;
};
export declare function buildP2PTools(mesh: MeshNetwork, router?: InstanceRouter, options?: BuildP2PToolsOptions): ({
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            peerId: {
                type: "string";
                description: string;
            };
            message: {
                type: "string";
                description: string;
            };
            topic?: undefined;
            instanceId?: undefined;
            selector?: undefined;
            match?: undefined;
            dryRun?: undefined;
            scope?: undefined;
        };
        required: string[];
        anyOf?: undefined;
    };
    execute(_toolCallId: string, params: {
        peerId: string;
        message: string;
    }): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            sent: boolean;
            peerId: string;
            error?: undefined;
        };
        isError?: undefined;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            sent: boolean;
            peerId: string;
            error: string;
        };
        isError: boolean;
    }>;
} | {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            topic: {
                type: "string";
                description: string;
            };
            message: {
                type: "string";
                description: string;
            };
            peerId?: undefined;
            instanceId?: undefined;
            selector?: undefined;
            match?: undefined;
            dryRun?: undefined;
            scope?: undefined;
        };
        required: string[];
        anyOf?: undefined;
    };
    execute(_toolCallId: string, params: {
        topic: string;
        message: string;
    }): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            broadcast: boolean;
            topic: string;
            error?: undefined;
        };
        isError?: undefined;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            broadcast: boolean;
            topic: string;
            error: string;
        };
        isError: boolean;
    }>;
} | {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            peerId?: undefined;
            message?: undefined;
            topic?: undefined;
            instanceId?: undefined;
            selector?: undefined;
            match?: undefined;
            dryRun?: undefined;
            scope?: undefined;
        };
        required?: undefined;
        anyOf?: undefined;
    };
    execute(_toolCallId: string): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            localPeerId: string;
            connectedPeers: string[];
            count: number;
            error?: undefined;
        };
        isError?: undefined;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            error: string;
            localPeerId?: undefined;
            connectedPeers?: undefined;
            count?: undefined;
        };
        isError: boolean;
    }>;
} | {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            peerId?: undefined;
            message?: undefined;
            topic?: undefined;
            instanceId?: undefined;
            selector?: undefined;
            match?: undefined;
            dryRun?: undefined;
            scope?: undefined;
        };
        required?: undefined;
        anyOf?: undefined;
    };
    execute(_toolCallId: string): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            initialized: boolean;
            identity?: undefined;
            error?: undefined;
        };
        isError?: undefined;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            identity: import("./types.js").InstanceIdentity;
            initialized?: undefined;
            error?: undefined;
        };
        isError?: undefined;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            error: string;
            initialized?: undefined;
            identity?: undefined;
        };
        isError: boolean;
    }>;
} | {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            peerId?: undefined;
            message?: undefined;
            topic?: undefined;
            instanceId?: undefined;
            selector?: undefined;
            match?: undefined;
            dryRun?: undefined;
            scope?: undefined;
        };
        required?: undefined;
        anyOf?: undefined;
    };
    execute(_toolCallId: string): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            peerId: string;
            instanceId: string | undefined;
            listenAddrs: string[];
            connectedPeers: string[];
            error?: undefined;
        };
        isError?: undefined;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            error: string;
            peerId?: undefined;
            instanceId?: undefined;
            listenAddrs?: undefined;
            connectedPeers?: undefined;
        };
        isError: boolean;
    }>;
} | {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            peerId?: undefined;
            message?: undefined;
            topic?: undefined;
            instanceId?: undefined;
            selector?: undefined;
            match?: undefined;
            dryRun?: undefined;
            scope?: undefined;
        };
        required?: undefined;
        anyOf?: undefined;
    };
    execute(_toolCallId: string): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            initialized: boolean;
            instances?: undefined;
            count?: undefined;
            error?: undefined;
        };
        isError: boolean;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            instances: (InstancePeerRecord & {
                connected: boolean;
                localLabels: LocalPeerLabelAttribute[];
            })[];
            count: number;
            initialized?: undefined;
            error?: undefined;
        };
        isError?: undefined;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            error: string;
            initialized?: undefined;
            instances?: undefined;
            count?: undefined;
        };
        isError: boolean;
    }>;
} | {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            instanceId: {
                type: "string";
                description: string;
            };
            peerId?: undefined;
            message?: undefined;
            topic?: undefined;
            selector?: undefined;
            match?: undefined;
            dryRun?: undefined;
            scope?: undefined;
        };
        required: string[];
        anyOf?: undefined;
    };
    execute(_toolCallId: string, params: {
        instanceId: string;
    }): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            initialized: boolean;
            error?: undefined;
            instanceId?: undefined;
            found?: undefined;
            route?: undefined;
        };
        isError: boolean;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            error: string;
            initialized?: undefined;
            instanceId?: undefined;
            found?: undefined;
            route?: undefined;
        };
        isError: boolean;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            instanceId: string;
            found: boolean;
            initialized?: undefined;
            error?: undefined;
            route?: undefined;
        };
        isError: boolean;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            found: boolean;
            route: InstancePeerRecord;
            initialized?: undefined;
            error?: undefined;
            instanceId?: undefined;
        };
        isError?: undefined;
    }>;
} | {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            instanceId: {
                type: "string";
                description: string;
            };
            message: {
                type: "string";
                description: string;
            };
            peerId?: undefined;
            topic?: undefined;
            selector?: undefined;
            match?: undefined;
            dryRun?: undefined;
            scope?: undefined;
        };
        required: string[];
        anyOf?: undefined;
    };
    execute(_toolCallId: string, params: {
        instanceId: string;
        message: string;
    }): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            initialized: boolean;
            error?: undefined;
        };
        isError: boolean;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            error: string;
            initialized?: undefined;
        };
        isError: boolean;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            sent: boolean;
            delivered: boolean;
            toInstanceId: string;
            toPeerId: string;
            ackMessageId?: string;
            inboundChannel?: string;
            inboundTarget?: string;
            deliveryResults?: DeliveryTargetResult[];
            error?: string;
        };
        isError: boolean | undefined;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            sent: boolean;
            delivered: boolean;
            toInstanceId: string;
            toPeerId: string;
            ackMessageId?: string;
            inboundChannel?: string;
            inboundTarget?: string;
            deliveryResults?: DeliveryTargetResult[];
            error?: string;
        };
        isError?: undefined;
    }>;
} | {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            selector: {
                type: "string";
                description: string;
            };
            match: {
                type: "object";
                deprecated: boolean;
                description: string;
                oneOf: ({
                    type: "object";
                    additionalProperties: boolean;
                    properties: {
                        kind: {
                            const: "tag";
                        };
                        value: {
                            type: "string";
                            description: string;
                        };
                        key?: undefined;
                    };
                    required: string[];
                } | {
                    type: "object";
                    additionalProperties: boolean;
                    properties: {
                        kind: {
                            const: "structured";
                        };
                        key: {
                            type: "string";
                            description: string;
                        };
                        value: {
                            type: "string";
                            description: string;
                        };
                    };
                    required: string[];
                })[];
            };
            message: {
                type: "string";
                description: string;
            };
            dryRun: {
                type: "boolean";
                description: string;
            };
            scope: {
                type: "string";
                enum: string[];
                description: string;
            };
            peerId?: undefined;
            topic?: undefined;
            instanceId?: undefined;
        };
        required: string[];
        anyOf: {
            required: string[];
        }[];
    };
    execute(_toolCallId: string, params: SendUserAttributeToolParams): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            initialized: boolean;
            error?: undefined;
        };
        isError: boolean;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            error: string;
            initialized?: undefined;
        };
        isError: boolean;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: import("./types.js").UserAttributeMessageResult;
        isError?: undefined;
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: import("./types.js").UserAttributeMessageResult;
        isError: boolean | undefined;
    }>;
})[];
export {};
