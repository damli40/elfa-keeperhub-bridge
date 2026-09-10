declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
}

declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args: string[],
    options: { stdio: "inherit" },
  ): void;
}
