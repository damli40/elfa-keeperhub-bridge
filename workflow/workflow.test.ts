import { describe, it, expect } from "vitest";
import base from "./keeperhub-workflow.base.json";
import sepolia from "./keeperhub-workflow.sepolia.json";
import actionSchemas from "./action-schemas.fixture.json";

interface Node {
  id: string;
  data: { label: string; config: Record<string, unknown> };
}
interface Workflow {
  name: string;
  nodes: Node[];
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
}

const workflows: Array<[string, Workflow]> = [
  ["base", base as Workflow],
  ["sepolia", sepolia as Workflow],
];

/** Fields whose value decides how much moves, where it goes, or on what chain. */
const MONEY_FIELDS = [
  "amountIn", "amountOut", "amountOutMinimum", "amountInMaximum", "ethValue",
  "address", "recipient", "tokenIn", "tokenOut", "fee", "chainId", "network", "integrationId",
];

/**
 * Task 7 fills these in by hand. Until then, any test that needs to recognise
 * "this is the not-yet-real Telegram id" checks against these exact strings.
 */
const TELEGRAM_INTEGRATION_ID_PLACEHOLDER = "TELEGRAM_INTEGRATION_ID";
const TELEGRAM_CHAT_ID_PLACEHOLDER = "TELEGRAM_CHAT_ID";

describe.each(workflows)("%s workflow", (_name, wf) => {
  it("references the trigger only in human-readable message text", () => {
    for (const node of wf.nodes) {
      for (const [field, value] of Object.entries(node.data.config)) {
        if (typeof value !== "string") continue;
        if (!value.includes("trigger-1")) continue;
        expect(MONEY_FIELDS).not.toContain(field);
        expect(field).toBe("message");
      }
    }
  });

  it("gives every Condition edge an explicit branch", () => {
    const conditionIds = wf.nodes.filter((n) => n.data.config.actionType === "Condition").map((n) => n.id);
    for (const edge of wf.edges) {
      if (conditionIds.includes(edge.source)) {
        expect(["true", "false"]).toContain(edge.sourceHandle);
      }
    }
  });

  it("wires both branches of every Condition", () => {
    const conditionIds = wf.nodes.filter((n) => n.data.config.actionType === "Condition").map((n) => n.id);
    for (const id of conditionIds) {
      const handles = wf.edges.filter((e) => e.source === id).map((e) => e.sourceHandle);
      expect(handles).toContain("true");
      expect(handles).toContain("false");
    }
  });

  it("points every edge at a node that exists", () => {
    const ids = new Set(wf.nodes.map((n) => n.id));
    for (const edge of wf.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it("sets parseMode none and both Telegram identifiers on every message node", () => {
    for (const node of wf.nodes) {
      if (node.data.config.actionType !== "telegram/send-message") continue;
      expect(node.data.config.parseMode).toBe("none");
      expect(node.data.config.integrationId).toBeTruthy();
      expect(node.data.config.chatId).toBeTruthy();
    }
  });

  it("uses no name from another project", () => {
    expect(JSON.stringify(wf)).not.toMatch(/guardian/i);
    expect(JSON.stringify(wf)).not.toMatch(/sentinel/i);
  });

  it("uses only actionTypes present in the committed schema fixture", () => {
    const known = new Set(actionSchemas.actionTypes);
    for (const node of wf.nodes) {
      const actionType = node.data.config.actionType;
      if (typeof actionType !== "string") continue;
      expect(known.has(actionType)).toBe(true);
    }
  });

  it("has not been filled in with a real Telegram id yet", () => {
    for (const node of wf.nodes) {
      if (node.data.config.actionType !== "telegram/send-message") continue;
      expect(node.data.config.integrationId).toBe(TELEGRAM_INTEGRATION_ID_PLACEHOLDER);
      expect(node.data.config.chatId).toBe(TELEGRAM_CHAT_ID_PLACEHOLDER);
    }
  });
});

describe("base workflow money values", () => {
  const wf = base as Workflow;
  const node = (id: string) => wf.nodes.find((n) => n.id === id)!.data.config;

  it("expresses the same amount as wei on amountIn and as ETH on ethValue", () => {
    const swap = node("swap-1");
    const wei = BigInt(swap.amountIn as string);
    const eth = Number(swap.ethValue as string);
    expect(Number(wei) / 1e18).toBeCloseTo(eth, 12);
  });

  it("quotes exactly the amount it swaps", () => {
    expect(node("quote-1").amountIn).toBe(node("swap-1").amountIn);
  });

  it("uses the same slippage floor in the guard and in the swap", () => {
    const guard = node("cond-quote").condition as string;
    const floor = guard.match(/>=\s*(\d+)/)![1];
    expect(node("swap-1").amountOutMinimum).toBe(floor);
  });

  it("reads the quote through the result wrapper, not the bare field", () => {
    expect(node("cond-quote").condition).toContain("Quote.result.amountOut");
  });

  it("compares balance with a numeric operator, never strict equality", () => {
    expect(node("cond-bal").condition).toMatch(/>=/);
    expect(node("cond-bal").condition).not.toContain("===");
  });

  it("swaps WETH for USDC on Base at the 0.05 percent tier", () => {
    const swap = node("swap-1");
    expect(swap.tokenIn).toBe("0x4200000000000000000000000000000000000006");
    expect(swap.tokenOut).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(swap.network).toBe("8453");
    expect(swap.fee).toBe("500");
  });

  it("keeps a single run inside the 0.0055 ETH daily cap", () => {
    expect(BigInt(node("swap-1").amountIn as string)).toBeLessThan(5_500_000_000_000_000n);
  });
});

describe("bal-1 fails loudly, never silently", () => {
  it("never sets failOnError to anything but true on the balance check", () => {
    for (const [, wf] of workflows) {
      const bal = wf.nodes.find((n) => n.id === "bal-1")!.data.config;
      // failOnError is optional-but-if-present-must-be-true; KeeperHub's
      // documented default for web3/check-balance is to fail loudly already,
      // so absence is also acceptable — only an explicit false is a defect.
      if ("failOnError" in bal) {
        expect(bal.failOnError).toBe(true);
      }
    }
  });
});

describe("chain identifiers match their file", () => {
  it("base workflow targets chain 8453 everywhere a chain is named", () => {
    const wf = base as Workflow;
    const bal = wf.nodes.find((n) => n.id === "bal-1")!.data.config;
    expect(bal.chainId).toBe(8453);
    for (const id of ["quote-1", "swap-1"]) {
      expect(wf.nodes.find((n) => n.id === id)!.data.config.network).toBe("8453");
    }
  });

  it("sepolia workflow targets chain 84532 everywhere a chain is named", () => {
    const wf = sepolia as Workflow;
    const bal = wf.nodes.find((n) => n.id === "bal-1")!.data.config;
    expect(bal.chainId).toBe(84532);
    expect(wf.nodes.find((n) => n.id === "wrap-1")!.data.config.network).toBe("84532");
  });

  it("sepolia workflow has no Uniswap quote or swap node", () => {
    const wf = sepolia as Workflow;
    const actionTypes = wf.nodes.map((n) => n.data.config.actionType);
    expect(actionTypes).not.toContain("uniswap/quote-exact-input");
    expect(actionTypes).not.toContain("uniswap/swap-exact-input");
    expect(actionTypes).toContain("wrapped/wrap");
  });
});
