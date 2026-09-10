import { elfaCancel, elfaList } from "./elfa";
import { publishRoutes, readConfiguredRoutes } from "./setup";

export interface ElfaPlanSummary {
  id: string;
  status: string;
  title?: string;
}

export function normalizeElfaPlans(response: unknown): ElfaPlanSummary[] {
  const value = response as {
    queries?: unknown[];
    data?: unknown[];
  } | null;
  const rows = Array.isArray(response)
    ? response
    : Array.isArray(value?.queries)
      ? value.queries
      : Array.isArray(value?.data)
        ? value.data
        : [];

  return rows.flatMap((row) => {
    const plan = row as { id?: unknown; status?: unknown; title?: unknown };
    if (typeof plan.id !== "string" || typeof plan.status !== "string") {
      return [];
    }
    return [{
      id: plan.id,
      status: plan.status,
      ...(typeof plan.title === "string" ? { title: plan.title } : {}),
    }];
  });
}

export function selectRoutedActivePlans(
  plans: ElfaPlanSummary[],
  routes: Record<string, string>,
): ElfaPlanSummary[] {
  return plans.filter(
    (plan) => plan.status === "active" && Object.hasOwn(routes, plan.id),
  );
}

export async function runTeardown(): Promise<void> {
  const routes = readConfiguredRoutes();
  const plans = normalizeElfaPlans(await elfaList());
  const active = selectRoutedActivePlans(plans, routes);

  for (const plan of active) {
    await elfaCancel(plan.id);
    console.log(`Cancelled ${plan.id} (${plan.title ?? "untitled"})`);
  }

  publishRoutes({}, false);
  console.log(
    active.length === 0
      ? "No routed active plans found; bridge disabled."
      : `Cancelled ${active.length} routed plan(s); bridge disabled.`,
  );
}
