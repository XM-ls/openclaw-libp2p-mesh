import type { PluginLogger } from "openclaw/plugin-sdk/core";
import {
  resolveConfigPath,
  readFullConfig,
  writeFullConfig,
  getNonDefaultConfig,
  getDefaultConfig,
} from "./config-io.js";
import {
  createReadlinePrompter,
  runSetupWizard,
  WizardCancelledError,
} from "./wizard.js";

// OpenClawPluginCliContext is defined in openclaw's types.d.ts but not re-exported
// from the public SDK barrel modules at this version. Define the shape locally.
interface MinimalCommand {
  command(name: string): MinimalCommand;
  description(desc: string): MinimalCommand;
  option(flags: string, description?: string): MinimalCommand;
  action(fn: (...args: any[]) => void | Promise<void>): MinimalCommand;
}
interface OpenClawPluginCliContext {
  program: MinimalCommand;
  config: Record<string, unknown>;
  workspaceDir?: string;
  logger: PluginLogger;
}

export function registerLibp2pMeshCli(ctx: OpenClawPluginCliContext): void {
  const { program, config: openclawConfig } = ctx;

  const meshCmd = program
    .command("libp2p-mesh")
    .description("P2P Mesh 网络插件配置管理");

  // ---- setup ----
  meshCmd
    .command("setup")
    .description("交互式配置向导")
    .action(async () => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);

      // Discover available chat channels from config
      const channels = openclawConfig.channels;
      const availableChannels: string[] = [];
      if (channels && typeof channels === "object" && !Array.isArray(channels)) {
        for (const [id, entry] of Object.entries(channels as Record<string, unknown>)) {
          if (
            id !== "libp2p-mesh" &&
            entry &&
            typeof entry === "object" &&
            (entry as Record<string, unknown>).enabled !== false
          ) {
            availableChannels.push(id);
          }
        }
      }

      try {
        const prompter = createReadlinePrompter();
        const newConfig = await runSetupWizard(prompter, pluginConfig, availableChannels);
        writeFullConfig(configPath, newConfig);
        console.log(`\n✓ 配置已写入 ${configPath}`);
        console.log("  运行 openclaw gateway restart 使新配置生效。");
      } catch (err) {
        if (err instanceof WizardCancelledError) {
          process.exit(0);
        }
        if (err instanceof Error) {
          console.error(`\n✗ ${err.message}`);
        }
        process.exit(1);
      }
    });

  // ---- config list ----
  meshCmd
    .command("list")
    .description("列出当前所有非默认配置")
    .action(() => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);
      const nonDefault = getNonDefaultConfig(pluginConfig);
      const keys = Object.keys(nonDefault);

      if (keys.length === 0) {
        console.log("当前无自定义配置，全部使用默认值。");
        console.log("运行 openclaw libp2p-mesh setup 进行配置。");
        return;
      }

      console.log("─────────────────────────────────");
      console.log("  当前 libp2p-mesh 配置：\n");
      for (const key of keys) {
        const value = nonDefault[key];
        if (Array.isArray(value)) {
          console.log(`  ${key}:`);
          if (value.length === 0) {
            console.log("    （空列表）");
          } else {
            for (const item of value) {
              if (typeof item === "object" && item !== null) {
                const obj = item as Record<string, unknown>;
                const label = obj.id ? `${obj.id} — ` : "";
                console.log(`    - ${label}${obj.channel ?? ""} / ${obj.target ?? ""}`);
              } else {
                console.log(`    - ${item}`);
              }
            }
          }
        } else {
          console.log(`  ${key}:  ${value}`);
        }
      }
      console.log(`\n  ...共 ${keys.length} 项非默认配置`);
    });

  // ---- config get ----
  meshCmd
    .command("get <key>")
    .description("读取单个配置值")
    .action((key: string) => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);
      const defaults = getDefaultConfig();
      const value = key in pluginConfig ? pluginConfig[key] : defaults[key];
      if (value === undefined) {
        console.log(`  （未配置）`);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          console.log("  （空列表）");
        } else {
          for (const item of value) {
            if (typeof item === "object" && item !== null) {
              console.log(JSON.stringify(item, null, 2));
            } else {
              console.log(`  ${item}`);
            }
          }
        }
      } else {
        console.log(`  ${value}`);
      }
    });

  // ---- config set ----
  meshCmd
    .command("set <key> [value]")
    .description("设置配置值。数组类型使用 --add / --remove")
    .option("--add <item>", "追加到数组")
    .option("--remove <item>", "从数组中移除")
    .action(async (key: string, value: string | undefined, opts: { add?: string; remove?: string }) => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);
      const defaults = getDefaultConfig();
      const current = key in pluginConfig ? pluginConfig[key] : defaults[key];
      const oldValue = current;

      let newValue: unknown;

      // Array operations
      if (opts.add || opts.remove) {
        const arr: unknown[] = Array.isArray(current) ? [...current] : [];
        if (opts.add) {
          if (arr.includes(opts.add)) {
            console.log(`  ⚠ 该值已存在`);
            return;
          }
          arr.push(opts.add);
          console.log(`  ✓ 已追加`);
        }
        if (opts.remove) {
          const idx = arr.indexOf(opts.remove);
          if (idx === -1) {
            console.log(`  ⚠ 未找到该值`);
            return;
          }
          arr.splice(idx, 1);
          console.log(`  ✓ 已移除`);
        }
        newValue = arr;
      } else {
        // Scalar
        if (value === undefined) {
          console.error("  请提供值。用法: openclaw libp2p-mesh config set <key> <value>");
          process.exit(1);
        }
        // Auto-detect boolean and number
        if (value === "true") newValue = true;
        else if (value === "false") newValue = false;
        else if (/^-?\d+(\.\d+)?$/.test(value)) newValue = Number(value);
        else newValue = value;
      }

      // Write
      const updates = { ...pluginConfig, [key]: newValue };
      writeFullConfig(configPath, updates);

      // Feedback
      if (!opts.add && !opts.remove) {
        console.log(`  ✓ ${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
      }
    });

  // ---- config unset ----
  meshCmd
    .command("unset <key>")
    .description("删除 key，恢复默认值")
    .action((key: string) => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);
      const newConfig = { ...pluginConfig };
      delete newConfig[key];
      writeFullConfig(configPath, newConfig);
      console.log(`  ✓ ${key} 已恢复为默认值`);
    });
}
