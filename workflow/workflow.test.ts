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

const WALLET_ADDRESS = "0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98";
const WALLET_INTEGRATION_ID = "v0dqh167ypmjqxyds6tuh";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

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

/**
 * Exact, non-lossy ETH-decimal-string -> wei conversion. Used instead of
 * Number()/1e18 float math so a comparison against amountIn can never pass
 * or fail because of floating-point rounding.
 */
function ethToWei(ethStr: string): bigint {
  const [wholeRaw, fracRaw = ""] = ethStr.split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "0".repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(frac || "0");
}

/**
 * Flattens a node's config into { field, value } leaves so a trigger-1
 * reference buried inside a nested object or array (config.meta.recipient,
 * config.args[0], ...) is still found, not just top-level properties.
 * `field` is the leaf's own property name (e.g. "recipient" whether it sits
 * at config.recipient or config.meta.recipient) — the check below only
 * cares what the field is called, not how deep it is nested.
 */
function flattenConfig(config: Record<string, unknown>): Array<{ field: string; value: unknown }> {
  const out: Array<{ field: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(config)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && typeof item === "object") {
          out.push(...flattenConfig(item as Record<string, unknown>));
        } else {
          out.push({ field: key, value: item });
        }
      }
    } else if (value !== null && typeof value === "object") {
      out.push(...flattenConfig(value as Record<string, unknown>));
    } else {
      out.push({ field: key, value });
    }
  }
  return out;
}

describe.each(workflows)("%s workflow", (_name, wf) => {
  it("references the trigger only in human-readable message text, even nested", () => {
    for (const node of wf.nodes) {
      for (const { field, value } of flattenConfig(node.data.config)) {
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

  it("compares balance with a numeric operator, never strict equality", () => {
    const cond = wf.nodes.find((n) => n.id === "cond-bal")!.data.config.condition as string;
    expect(cond).toMatch(/>=/);
    expect(cond).not.toContain("===");
  });

  it("pins the balance floor to exactly 0.0025 ETH", () => {
    const cond = wf.nodes.find((n) => n.id === "cond-bal")!.data.config.condition as string;
    const match = cond.match(/>=\s*([\d.]+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("0.0025");
  });

  it("anchors the balance-check address to the approved wallet, exact checksum", () => {
    const bal = wf.nodes.find((n) => n.id === "bal-1")!.data.config;
    expect(bal.address).toBe(WALLET_ADDRESS);
  });

  it("anchors integrationId to the approved wallet integration on every node that signs a transaction", () => {
    // Only nodes that actually move funds carry the wallet integrationId.
    // Telegram nodes also have an "integrationId" field, but it names the
    // Telegram bot integration (still a TELEGRAM_INTEGRATION_ID placeholder
    // at this point — see the placeholder test above), not the wallet.
    const SIGNING_ACTION_TYPES = ["uniswap/swap-exact-input", "wrapped/wrap"];
    for (const node of wf.nodes) {
      if (!SIGNING_ACTION_TYPES.includes(node.data.config.actionType as string)) continue;
      expect(node.data.config.integrationId).toBe(WALLET_INTEGRATION_ID);
    }
  });
});

describe("base workflow money values", () => {
  const wf = base as Workflow;
  const node = (id: string) => wf.nodes.find((n) => n.id === id)!.data.config;

  it("expresses the same amount as wei on amountIn and as ETH on ethValue (exact, no float)", () => {
    const swap = node("swap-1");
    expect(BigInt(swap.amountIn as string)).toBe(ethToWei(swap.ethValue as string));
  });

  it("moves exactly the approved amount: 2000000000000000 wei / 0.002 ETH, not a nearby figure", () => {
    const swap = node("swap-1");
    expect(swap.amountIn).toBe("2000000000000000");
    expect(swap.ethValue).toBe("0.002");
    expect(node("quote-1").amountIn).toBe("2000000000000000");
  });

  it("pins the swap floor to exactly the approved minimum-out, 4828900, in both the guard and the swap", () => {
    expect(node("swap-1").amountOutMinimum).toBe("4828900");
    const cond = node("cond-quote").condition as string;
    const match = cond.match(/>=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("4828900");
  });

  it("reads the quote through the result wrapper, not the bare field", () => {
    expect(node("cond-quote").condition).toContain("Quote.result.amountOut");
  });

  it("swaps WETH for USDC on Base at the 0.05 percent tier", () => {
    const swap = node("swap-1");
    expect(swap.tokenIn).toBe(WETH_BASE);
    expect(swap.tokenOut).toBe(USDC_BASE);
    expect(swap.network).toBe("8453");
    expect(swap.fee).toBe("500");
  });

  it("quotes the same WETH->USDC pair it swaps, in the same order (not swapped)", () => {
    const quote = node("quote-1");
    expect(quote.tokenIn).toBe(WETH_BASE);
    expect(quote.tokenOut).toBe(USDC_BASE);
  });

  it("sends the swap output to the approved wallet, not an arbitrary recipient", () => {
    expect(node("swap-1").recipient).toBe(WALLET_ADDRESS);
  });

  it("keeps a single run inside the 0.0055 ETH daily cap", () => {
    expect(BigInt(node("swap-1").amountIn as string)).toBeLessThan(5_500_000_000_000_000n);
  });

  it("keeps the balance floor above the amount moved, so the gas reserve survives", () => {
    const guard = node("cond-bal").condition as string;
    const floor = Number(guard.match(/>=\s*([\d.]+)/)![1]);
    const moved = Number(node("swap-1").ethValue as string);
    expect(floor).toBeGreaterThan(moved);
  });
});

describe("sepolia workflow money values", () => {
  const wf = sepolia as Workflow;
  const node = (id: string) => wf.nodes.find((n) => n.id === id)!.data.config;

  it("wraps exactly the approved amount: 0.002 ETH", () => {
    expect(node("wrap-1").ethValue).toBe("0.002");
  });

  it("keeps a single run inside the 0.0055 ETH daily cap", () => {
    expect(ethToWei(node("wrap-1").ethValue as string)).toBeLessThan(5_500_000_000_000_000n);
  });

  it("keeps the balance floor above the amount moved, so the gas reserve survives", () => {
    const guard = node("cond-bal").condition as string;
    const floor = Number(guard.match(/>=\s*([\d.]+)/)![1]);
    const moved = Number(node("wrap-1").ethValue as string);
    expect(floor).toBeGreaterThan(moved);
  });
});

describe("bal-1 fails loudly, never silently", () => {
  it("sets failOnError to true on the balance check — absence is also a defect", () => {
    for (const [, wf] of workflows) {
      const bal = wf.nodes.find((n) => n.id === "bal-1")!.data.config;
      expect(bal.failOnError).toBe(true);
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
