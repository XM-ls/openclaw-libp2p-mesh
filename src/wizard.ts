import * as readline from "node:readline/promises";
import { MULTIADDR_PATTERN } from "./config-io.js";

// --- Types ---

export interface PromptChoice {
  label: string;
  value: string;
  hint?: string;
}

export interface WizardPrompter {
  question(prompt: string, defaultValue?: string): Promise<string>;
  confirm(prompt: string, defaultValue?: boolean): Promise<boolean>;
  select(prompt: string, choices: PromptChoice[]): Promise<string>;
  multiline(prompt: string, helpText?: string): Promise<string[]>;
  displayBox(title: string, lines: string[]): void;
  displaySuccess(message: string): void;
  displayError(message: string): void;
  displayWarning(message: string): void;
}

// --- Validation ---

export function validateMultiaddr(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "地址不能为空";
  if (!MULTIADDR_PATTERN.test(trimmed)) {
    return "多地址格式无效，必须以 /ip4/、/ip6/ 或 /dns/ 开头，如 /ip4/198.51.100.5/tcp/4001/p2p/12D3KooW...";
  }
  return null;
}

// --- Readline Prompter ---

export function createReadlinePrompter(): WizardPrompter {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const displayWidth = 60;

  function boxify(title: string, lines: string[]): void {
    const top = "┌" + "─".repeat(displayWidth - 2) + "┐";
    const padTitle = "│  " + title.padEnd(displayWidth - 6) + "  │";
    const sep = "│" + " ".repeat(displayWidth - 2) + "│";
    const bottom = "└" + "─".repeat(displayWidth - 2) + "┘";
    console.log(top);
    console.log(padTitle);
    console.log(sep);
    for (const line of lines) {
      const padLine = "│  " + line.padEnd(displayWidth - 6) + "  │";
      console.log(padLine);
    }
    console.log(bottom);
  }

  function formatChoices(choices: PromptChoice[]): string {
    return choices
      .map((c, i) => {
        const hint = c.hint ? `（${c.hint}）` : "";
        return `  ${i + 1}. ${c.label} ${hint}`.trimEnd();
      })
      .join("\n");
  }

  async function question(prompt: string, defaultValue?: string): Promise<string> {
    const suffix = defaultValue ? `（${defaultValue}）` : "";
    const answer = await rl.question(`${prompt}${suffix} → `);
    return answer.trim() || defaultValue || "";
  }

  async function confirm(prompt: string, defaultValue?: boolean): Promise<boolean> {
    const def = defaultValue === undefined ? true : defaultValue;
    const yn = def ? "Y/n" : "y/N";
    const answer = await rl.question(`${prompt}（${yn}）→ `);
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "y" || trimmed === "yes") return true;
    if (trimmed === "n" || trimmed === "no") return false;
    return def;
  }

  async function select(prompt: string, choices: PromptChoice[]): Promise<string> {
    console.log(`\n${prompt}`);
    console.log(formatChoices(choices));
    let answer = "";
    while (true) {
      const raw = await rl.question(`  → `);
      const num = parseInt(raw.trim(), 10);
      if (num >= 1 && num <= choices.length) {
        answer = choices[num - 1]!.value;
        break;
      }
      console.log(`  请输入 1-${choices.length} 之间的数字。`);
    }
    return answer;
  }

  async function multiline(prompt: string, helpText?: string): Promise<string[]> {
    console.log(`\n${prompt}`);
    if (helpText) console.log(helpText);
    const lines: string[] = [];
    while (true) {
      const line = await rl.question("  ");
      if (!line.trim()) break;
      const err = validateMultiaddr(line);
      if (err) {
        console.log(`  ⚠ ${err}`);
        continue;
      }
      if (lines.includes(line.trim())) {
        console.log("  ⚠ 该地址已存在");
        continue;
      }
      lines.push(line.trim());
    }
    if (lines.length > 0) {
      console.log(`  ✓ 已添加 ${lines.length} 个地址`);
    }
    return lines;
  }

  function displayBox(title: string, lines: string[]): void {
    boxify(title, lines);
  }

  function displaySuccess(message: string): void {
    console.log(`  ✓ ${message}`);
  }

  function displayError(message: string): void {
    console.log(`  ✗ ${message}`);
  }

  function displayWarning(message: string): void {
    console.log(`  ⚠ ${message}`);
  }

  return {
    question,
    confirm,
    select,
    multiline,
    displayBox,
    displaySuccess,
    displayError,
    displayWarning,
  };
}

// --- Setup Wizard Logic (pure — takes prompter, returns config object) ---

export async function runSetupWizard(
  prompter: WizardPrompter,
  currentConfig: Record<string, unknown>,
  availableChannels: string[],
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = { ...currentConfig };

  // --- Welcome ---
  prompter.displayBox("🕸️  libp2p-mesh 配置向导", [
    "我们将引导你完成 P2P Mesh 网络的基础配置。",
    "任何时候按 Ctrl+C 可退出，配置不会被保存。",
  ]);

  // =================================================================
  // Layer 1: Core Path
  // =================================================================

  // Step 1: Discovery mode
  const discovery = await prompter.select("选择节点发现方式：", [
    { value: "mdns", label: "mDNS — 局域网自动发现", hint: "默认，同一 WiFi 下推荐" },
    { value: "bootstrap", label: "Bootstrap — 手动指定已知节点地址", hint: "跨网络场景" },
    { value: "dht", label: "DHT — Kademlia 分布式发现", hint: "需要至少一个 bootstrap 入口" },
  ]);
  config.discovery = discovery;

  // Step 2: Bootstrap addresses (only if discovery=bootstrap or dht)
  if (discovery === "bootstrap" || discovery === "dht") {
    const addrs = await prompter.multiline(
      "输入 Bootstrap 节点地址（每行一个，空行结束）：",
      "  格式: /ip4/<IP>/tcp/<端口>/p2p/<PeerID>",
    );
    if (addrs.length > 0) {
      config.bootstrapList = addrs;
    }
  }

  // Step 3: Inbound targets
  if (availableChannels.length === 0) {
    prompter.displayWarning("未检测到已安装的聊天频道插件。你可以稍后在 openclaw.json 中手动配置 inboundTargets。");
  } else {
    const targets: Array<{ id?: string; channel: string; target: string }> = [];
    let addMore = true;
    while (addMore) {
      const channelChoices: PromptChoice[] = availableChannels.map((ch) => ({
        value: ch,
        label: ch,
      }));
      const channel = await prompter.select("选择接收 P2P 消息的聊天频道：", channelChoices);
      const target = await prompter.question(`输入 ${channel} 的接收目标（如 user:ou_xxx 或 chat:oc_xxx）：`);
      if (target) {
        targets.push({ channel, target });
      }
      addMore = await prompter.confirm("是否添加更多接收目标？", false);
    }
    if (targets.length > 0) {
      if (targets.length === 1 && !currentConfig.inboundChannel && !currentConfig.inboundTarget) {
        // Single target: also set legacy inboundChannel/inboundTarget for backwards compat
        config.inboundChannel = targets[0]!.channel;
        config.inboundTarget = targets[0]!.target;
      }
      config.inboundTargets = targets;
    }
  }

  // Step 4: Preview core config and confirm
  const corePreview = formatConfigPreview(config);
  prompter.displayBox("即将写入以下配置：", corePreview);
  const coreConfirmed = await prompter.confirm("确认写入？", true);
  if (!coreConfirmed) {
    prompter.displayWarning("已取消，配置未保存。");
    throw new WizardCancelledError();
  }

  // =================================================================
  // Layer 2: Advanced (optional)
  // =================================================================

  const wantsAdvanced = await prompter.confirm("需要在不同网络之间使用吗（跨 WiFi / 跨城市）？", false);
  if (wantsAdvanced) {
    // Fixed port
    const wantFixedPort = await prompter.confirm("是否使用固定监听端口？（推荐跨网络场景）", false);
    if (wantFixedPort) {
      const port = await prompter.question("端口号", "4001");
      const portNum = parseInt(port, 10);
      if (!isNaN(portNum) && portNum > 0 && portNum < 65536) {
        config.listenAddrs = [`/ip4/0.0.0.0/tcp/${portNum}`];
      }
    }

    // NAT traversal
    const wantNAT = await prompter.confirm("是否启用 NAT 穿透？（默认开启，推荐保留）", true);
    config.enableNATTraversal = wantNAT;

    // Circuit Relay
    const wantRelay = await prompter.confirm("需要配置 Circuit Relay 中继节点吗？", false);
    if (wantRelay) {
      const relays = await prompter.multiline(
        "输入 Relay 节点地址（每行一个，空行结束）：",
        "  格式: /ip4/<IP>/tcp/<端口>/p2p/<PeerID>",
      );
      if (relays.length > 0) {
        config.relayList = relays;
      }
    }

    // Custom instance name
    const wantName = await prompter.confirm("为此节点设置一个自定义名称吗？（用于 P2P 网络中的身份显示）", false);
    if (wantName) {
      const name = await prompter.question("节点名称");
      if (name) {
        config.instanceName = name;
      }
    }

    // Final preview and confirm (only if advanced config changed)
    if (wantFixedPort || wantRelay || wantName || !config.enableNATTraversal) {
      const finalPreview = formatConfigPreview(config);
      prompter.displayBox("高级配置已追加，最终预览：", finalPreview);
      const finalConfirmed = await prompter.confirm("确认写入？", true);
      if (!finalConfirmed) {
        prompter.displayWarning("已取消高级配置，核心配置已保存。");
      }
    }
  }

  prompter.displaySuccess("配置完成。运行 openclaw gateway restart 使配置生效。");
  return config;
}

export class WizardCancelledError extends Error {
  constructor() {
    super("Wizard cancelled by user");
    this.name = "WizardCancelledError";
  }
}

// --- Helpers ---

function formatConfigPreview(config: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (config.discovery) {
    lines.push(`discovery:       ${config.discovery}`);
  }
  if (Array.isArray(config.bootstrapList) && config.bootstrapList.length > 0) {
    lines.push(`bootstrapList:   ${config.bootstrapList.length} 个节点`);
    for (const addr of config.bootstrapList) {
      lines.push(`    ${addr}`);
    }
  }
  if (Array.isArray(config.inboundTargets) && config.inboundTargets.length > 0) {
    lines.push("inboundTargets:");
    for (const t of config.inboundTargets as Array<{ id?: string; channel: string; target: string }>) {
      lines.push(`    - ${t.channel} / ${t.target}`);
    }
  } else if (config.inboundChannel && config.inboundTarget) {
    lines.push(`inboundChannel:  ${config.inboundChannel}`);
    lines.push(`inboundTarget:   ${config.inboundTarget}`);
  }
  if (Array.isArray(config.listenAddrs) && config.listenAddrs.length > 0) {
    lines.push(`listenAddrs:     ${(config.listenAddrs as string[]).join(", ")}`);
  }
  if (config.enableNATTraversal !== undefined) {
    lines.push(`NAT 穿透:         ${config.enableNATTraversal ? "开启" : "关闭"}`);
  }
  if (Array.isArray(config.relayList) && config.relayList.length > 0) {
    lines.push(`relayList:       ${config.relayList.length} 个节点`);
  }
  if (config.instanceName) {
    lines.push(`instanceName:    ${config.instanceName}`);
  }
  if (lines.length === 0) {
    lines.push("（无配置更改）");
  }
  return lines;
}
