import { loadLocalEnv } from "./env";
import { runSetup } from "./setup";

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
    default:
      console.error("usage: npm run bridge -- <setup|fire|status|teardown> [flags]");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
