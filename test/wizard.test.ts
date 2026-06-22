import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Types that wizard.ts will export
interface PromptChoice {
  label: string;
  value: string;
  hint?: string;
}

interface WizardPrompter {
  question(prompt: string, defaultValue?: string): Promise<string>;
  confirm(prompt: string, defaultValue?: boolean): Promise<boolean>;
  select(prompt: string, choices: PromptChoice[]): Promise<string>;
  multiline(prompt: string, helpText?: string): Promise<string[]>;
  displayBox(title: string, lines: string[]): void;
  displaySuccess(message: string): void;
  displayError(message: string): void;
  displayWarning(message: string): void;
}

describe("validateMultiaddr", () => {
  it("accepts valid IPv4 multiaddr with peer id", () => {
    // validateMultiaddr("/ip4/198.51.100.5/tcp/4001/p2p/12D3KooW...")
    // returns null (no error)
  });

  it("accepts valid IPv4 multiaddr without peer id", () => {
    // validateMultiaddr("/ip4/0.0.0.0/tcp/4001")
    // returns null
  });

  it("accepts dns multiaddr", () => {
    // validateMultiaddr("/dns/example.com/tcp/4001/p2p/12D3KooW...")
    // returns null
  });

  it("accepts WebSocket multiaddr", () => {
    // validateMultiaddr("/ip4/198.51.100.5/ws/4002")
    // returns null
  });

  it("rejects empty string", () => {
    const err = validateMultiaddr("");
    assert.ok(err !== null);
  });

  it("rejects random text", () => {
    const err = validateMultiaddr("hello world");
    assert.ok(err !== null);
  });

  it("rejects address without protocol prefix", () => {
    const err = validateMultiaddr("198.51.100.5:4001");
    assert.ok(err !== null);
  });
});

describe("WizardPrompter mock", () => {
  it("collects user answers through mock prompter", async () => {
    // Test that runSetupWizard with a mock prompter returns expected config
  });
});

describe("runSetupWizard", () => {
  it("produces mdns config when user selects mdns", async () => {
    const mockPrompter: WizardPrompter = {
      question: async () => "",
      confirm: async () => false,
      select: async (_prompt, choices) => choices[0]!.value, // always pick first
      multiline: async () => [],
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu"]);
    assert.equal(result.discovery, "mdns");
  });

  it("produces bootstrap config with addresses", async () => {
    const addresses = ["/ip4/198.51.100.5/tcp/4001/p2p/12D3KooW..."];
    let selectCall = 0;
    let multilineCall = 0;
    const mockPrompter: WizardPrompter = {
      question: async (prompt: string) => {
        if (prompt.includes("接收目标")) return "user:ou_abc123";
        return "";
      },
      confirm: async () => false,
      select: async () => {
        selectCall++;
        return "bootstrap"; // discovery mode
      },
      multiline: async () => {
        multilineCall++;
        if (multilineCall === 1) return addresses; // bootstrap addresses
        return [];
      },
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu"]);
    assert.equal(result.discovery, "bootstrap");
    assert.deepEqual(result.bootstrapList, addresses);
  });

  it("skips advanced layer when user answers no to cross-network question", async () => {
    let confirmCalled = false;
    const mockPrompter: WizardPrompter = {
      question: async () => "user:ou_abc123",
      confirm: async (prompt: string) => {
        if (prompt.includes("不同网络")) {
          confirmCalled = true;
          return false;
        }
        return false;
      },
      select: async () => "mdns",
      multiline: async () => [],
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu"]);
    assert.equal(confirmCalled, true);
    // No advanced keys should be set
    assert.equal(result.enableNATTraversal, undefined);
    assert.equal(result.relayList, undefined);
  });

  it("includes advanced config when user answers yes to cross-network question", async () => {
    const mockPrompter: WizardPrompter = {
      question: async (prompt: string) => {
        if (prompt.includes("端口号")) return "4001";
        if (prompt.includes("名称")) return "my-home-server";
        if (prompt.includes("接收目标")) return "user:ou_abc123";
        return "";
      },
      confirm: async (prompt: string) => {
        if (prompt.includes("不同网络")) return true;
        if (prompt.includes("固定端口")) return true;
        if (prompt.includes("NAT 穿透")) return true;
        if (prompt.includes("Relay")) return true;
        if (prompt.includes("自定义名称")) return true;
        return true; // confirm write
      },
      select: async () => "mdns",
      multiline: async (prompt: string) => {
        if (prompt.includes("Relay")) return ["/ip4/198.51.100.5/tcp/4001/p2p/12D3KooW..."];
        return [];
      },
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu"]);
    assert.deepEqual(result.listenAddrs, ["/ip4/0.0.0.0/tcp/4001"]);
    assert.equal(result.enableNATTraversal, true);
    assert.equal(result.instanceName, "my-home-server");
  });

  it("collects multiple inbound targets", async () => {
    let confirmCount = 0;
    let questionCount = 0;
    const mockPrompter: WizardPrompter = {
      question: async (prompt: string) => {
        questionCount++;
        if (prompt.includes("接收目标")) {
          if (questionCount === 1) return "user:ou_abc123";
          return "chat:123456";
        }
        return "";
      },
      confirm: async (prompt: string) => {
        if (prompt.includes("更多接收目标")) {
          confirmCount++;
          return confirmCount === 1; // yes first time, no second
        }
        return false;
      },
      select: async () => "mdns",
      multiline: async () => [],
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu", "telegram"]);
    assert.ok(Array.isArray(result.inboundTargets));
    const targets = result.inboundTargets as Array<{ channel: string; target: string }>;
    assert.equal(targets.length, 2);
  });
});
