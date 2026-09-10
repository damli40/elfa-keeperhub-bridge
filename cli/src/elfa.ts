const ELFA_BASE = "https://api.elfa.ai/v2";

export interface ElfaCondition {
  source: string;
  method?: string;
  args: Record<string, unknown>;
  operator?: string;
  value?: unknown;
}

export interface ElfaQuery {
  title: string;
  description: string;
  conditions: { AND: ElfaCondition[] };
  actions: Array<{
    stepId: string;
    type: string;
    params: Record<string, string | boolean>;
  }>;
  expiresIn: string;
  repeat?: { cooldown: string; maxTriggers: number };
}

function apiKey(): string {
  const value = process.env.ELFA_API_KEY;
  if (!value) throw new Error("ELFA_API_KEY is not set");
  return value;
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("x-elfa-api-key", apiKey());
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${ELFA_BASE}${path}`, { ...init, headers });
  const text = await response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Elfa ${path} returned non-JSON (${response.status}): ${text.slice(0, 300)}`,
    );
  }

  // Elfa uses 422 for a well-formed validation result with query errors.
  if (!response.ok && response.status !== 422) {
    throw new Error(
      `Elfa ${path} failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }

  return parsed;
}

export function buildFundingQuery(
  webhookUrl: string,
  signingSecret: string,
): ElfaQuery {
  return {
    title: "BTC funding flips negative (Binance)",
    description:
      "Shorts now pay longs on Binance BTC perpetuals, a crowded-short signal. De-risk a fixed 0.002 ETH slice into USDC through KeeperHub.",
    conditions: {
      AND: [
        {
          source: "funding",
          method: "annualized_rate",
          args: { ticker: "BTC:BINANCE" },
          operator: "crosses_below",
          value: 0,
        },
      ],
    },
    actions: [
      {
        stepId: "step_1",
        type: "webhook",
        params: {
          url: webhookUrl,
          signingSecret,
          allNotifications: false,
        },
      },
    ],
    expiresIn: "168h",
    repeat: { cooldown: "24h", maxTriggers: 3 },
  };
}

export function buildPriceQuery(
  webhookUrl: string,
  signingSecret: string,
  symbol: string,
  threshold: number,
): ElfaQuery {
  return {
    title: `${symbol} crosses ${threshold} (demo trigger)`,
    description: `Demonstration trigger: fire once when ${symbol} crosses above ${threshold} on Hyperliquid, then hand execution to KeeperHub.`,
    conditions: {
      AND: [
        {
          source: "price",
          method: "current",
          args: { symbol, exchange: "hyperliquid" },
          operator: "crosses_above",
          value: threshold,
        },
      ],
    },
    actions: [
      {
        stepId: "step_1",
        type: "webhook",
        params: {
          url: webhookUrl,
          signingSecret,
          allNotifications: false,
        },
      },
    ],
    expiresIn: "1h",
  };
}

export const elfaValidate = (query: ElfaQuery): Promise<unknown> =>
  call("/auto/queries/validate", {
    method: "POST",
    body: JSON.stringify({ query }),
  });

export const elfaCreate = (query: ElfaQuery): Promise<unknown> =>
  call("/auto/queries", {
    method: "POST",
    body: JSON.stringify({ query }),
  });

export const elfaGet = (queryId: string): Promise<unknown> =>
  call(`/auto/queries/${encodeURIComponent(queryId)}`);

export const elfaCancel = (queryId: string): Promise<unknown> =>
  call(`/auto/queries/${encodeURIComponent(queryId)}/cancel`, {
    method: "POST",
  });

export const elfaList = (): Promise<unknown> => call("/auto/queries");
