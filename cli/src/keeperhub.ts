function baseUrl(): string {
  return process.env.KEEPERHUB_BASE ?? "https://app.keeperhub.com";
}

function apiKey(): string {
  const value = process.env.KEEPERHUB_API_KEY;
  if (!value) throw new Error("KEEPERHUB_API_KEY is not set");
  return value;
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey()}`);
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `KeeperHub ${path} failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `KeeperHub ${path} returned non-JSON (${response.status}): ${text.slice(0, 300)}`,
    );
  }
}

export const khUpdateWorkflow = (
  id: string,
  definition: unknown,
): Promise<unknown> =>
  call(`/api/workflows/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(definition),
  });

export const khGetWorkflow = (id: string): Promise<unknown> =>
  call(`/api/workflows/${encodeURIComponent(id)}`);

export const khLastExecution = async (
  workflowId: string,
): Promise<unknown> => {
  const result = (await call(
    `/api/workflows/${encodeURIComponent(workflowId)}/executions`,
  )) as unknown;

  const executions = Array.isArray(result)
    ? result
    : ((result as { executions?: unknown[] } | null)?.executions ?? []);

  return executions[0] ?? null;
};
