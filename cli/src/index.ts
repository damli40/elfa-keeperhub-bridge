import { loadLocalEnv } from "./env";
import { runFire } from "./fire";
import { runStatus } from "./status";
import { runSetup } from "./setup";
import { readConfiguredRoutes } from "./setup";
import { runTeardown } from "./teardown";

loadLocalEnv();

const [command, ...args] = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  switch (command) {
    case "setup": {
      const rawThreshold = flagValue("--threshold");
      const threshold = rawThreshold === undefined ? undefined : Number(rawThreshold);
      if (rawThreshold !== undefined && !Number.isFinite(threshold)) {
        throw new Error("--threshold must be a finite number");
      }
      await runSetup({ film: args.includes("--film"), threshold });
      break;
    }
    case "fire": {
      const queryId = flagValue("--query-id") ?? Object.keys(readConfiguredRoutes())[0];
      if (!queryId) throw new Error("No routed query id; run setup or pass --query-id");
      await runFire({
        eventId: flagValue("--event-id") ?? String(Date.now()),
        queryId,
        stale: args.includes("--stale"),
        badSignature: args.includes("--bad-sig"),
        unrouted: args.includes("--unrouted"),
      });
      break;
    }
    case "status":
      await runStatus();
      break;
    case "teardown":
      await runTeardown();
      break;
    default:
      console.error("usage: npm run bridge -- <setup|fire|status|teardown> [flags]");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
