import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const MULTIADDR_PATTERN = /^\/ip[46]\/(?:[\d.]+|[0-9a-fA-F:]+)\/(?:tcp|udp|ws|wss)\/\d+(?:\/p2p\/[12][a-zA-Z2-7]{48,})?$/;

export function getDefaultConfig(): Record<string, unknown> {
  return {
    listenAddrs: ["/ip4/0.0.0.0/tcp/0"],
    enableWebSocket: false,
    discovery: "mdns",
    meshTopic: "openclaw-mesh",
    enablePubsub: true,
    enableAgentSync: true,
    enableDHT: true,
    enableNATTraversal: true,
    enableIdentify: true,
    enableAutoNAT: true,
    enableUPnP: true,
    enableCircuitRelay: true,
    enableCircuitRelayServer: false,
    enableDCUtR: true,
    discoverRelays: 0,
    deliveryAckTimeoutMs: 15000,
  };
}

export function resolveConfigPath(): string {
  if (process.env.OPENCLAW_CONFIG_PATH) {
    const resolved = process.env.OPENCLAW_CONFIG_PATH.replace(/^~(?=$|\/|\\)/, os.homedir());
    return path.resolve(resolved);
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR
    ? process.env.OPENCLAW_STATE_DIR.replace(/^~(?=$|\/|\\)/, os.homedir())
    : path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "openclaw.json");
}

export function readFullConfig(configPath: string): {
  config: Record<string, unknown>;
  pluginConfig: Record<string, unknown>;
} {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: {}, pluginConfig: {} };
    }
    throw new Error(
      `无法解析 ${configPath}: ${(err as Error).message}\n请手动修复 JSON 格式后重试。`,
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${configPath} 内容不是合法的 JSON 对象。`);
  }

  const plugins = (raw as Record<string, unknown>).plugins;
  const entries =
    plugins && typeof plugins === "object" && !Array.isArray(plugins)
      ? (plugins as Record<string, unknown>).entries
      : undefined;
  const entry =
    entries && typeof entries === "object" && !Array.isArray(entries)
      ? (entries as Record<string, unknown>)["libp2p-mesh"]
      : undefined;
  const pluginConfig =
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? ((entry as Record<string, unknown>).config as Record<string, unknown>) ?? {}
      : {};

  return { config: raw as Record<string, unknown>, pluginConfig };
}

export function writeFullConfig(
  configPath: string,
  pluginConfigUpdates: Record<string, unknown>,
): void {
  // Ensure directory exists
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  // Read existing or start fresh
  let base: Record<string, unknown> = {};
  try {
    base = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `无法读取 ${configPath}: ${(err as Error).message}`,
      );
    }
  }

  // Create backup
  try {
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, configPath + ".bak");
    }
  } catch {
    // backup failure is non-fatal
  }

  // Build output object with deep merge
  const output = structuredClone(
    typeof base === "object" && !Array.isArray(base) ? base : {},
  );

  // Ensure plugins.entries["libp2p-mesh"] exists
  if (!output.plugins || typeof output.plugins !== "object" || Array.isArray(output.plugins)) {
    output.plugins = {};
  }
  const plugins = output.plugins as Record<string, unknown>;
  if (!plugins.entries || typeof plugins.entries !== "object" || Array.isArray(plugins.entries)) {
    plugins.entries = {};
  }
  const entries = plugins.entries as Record<string, unknown>;
  if (
    !entries["libp2p-mesh"] ||
    typeof entries["libp2p-mesh"] !== "object" ||
    Array.isArray(entries["libp2p-mesh"])
  ) {
    entries["libp2p-mesh"] = {};
  }
  const meshEntry = entries["libp2p-mesh"] as Record<string, unknown>;
  meshEntry.enabled = true;

  // Merge plugin config shallowly (key-level)
  if (!meshEntry.config || typeof meshEntry.config !== "object" || Array.isArray(meshEntry.config)) {
    meshEntry.config = {};
  }
  const existing = meshEntry.config as Record<string, unknown>;
  meshEntry.config = { ...existing, ...pluginConfigUpdates };

  // Ensure channels["libp2p-mesh"].enabled exists
  if (
    !output.channels ||
    typeof output.channels !== "object" ||
    Array.isArray(output.channels)
  ) {
    output.channels = {};
  }
  const channels = output.channels as Record<string, unknown>;
  if (
    !channels["libp2p-mesh"] ||
    typeof channels["libp2p-mesh"] !== "object" ||
    Array.isArray(channels["libp2p-mesh"])
  ) {
    channels["libp2p-mesh"] = {};
  }
  const meshChannel = channels["libp2p-mesh"] as Record<string, unknown>;
  meshChannel.enabled = true;

  // Write atomically (write to temp, then rename)
  const tmpPath = configPath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, configPath);
  } catch (err: unknown) {
    // Rollback from backup
    try {
      if (fs.existsSync(configPath + ".bak")) {
        fs.copyFileSync(configPath + ".bak", configPath);
      }
    } catch {
      // rollback failure — leave existing state
    }
    // Clean up temp
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ok
    }
    throw new Error(
      `写入 ${configPath} 失败：${(err as Error).message}。配置未更改。`,
    );
  }
}

export function getNonDefaultConfig(
  pluginConfig: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = getDefaultConfig();
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(pluginConfig)) {
    const value = pluginConfig[key];
    if (value === undefined) continue;
    if (!(key in defaults)) {
      // Unknown key — include (could be a new key added in later version)
      result[key] = value;
      continue;
    }
    const def = defaults[key];
    if (Array.isArray(value) && Array.isArray(def)) {
      if (value.length === 0 && def.length > 0) continue;
      if (value.length !== def.length || value.some((v, i) => v !== def[i])) {
        result[key] = value;
      }
    } else if (value !== def) {
      result[key] = value;
    }
  }
  return result;
}
