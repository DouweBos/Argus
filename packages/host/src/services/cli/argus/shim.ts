/**
 * `$ARGUS_HOME/cli/argus`: a shell shim the host rewrites at every launch, so
 * it always runs this build's CLI with this build's Node and `ARGUS_HOME`.
 */

import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../../lib/argusHome";
import { checkoutRoot } from "../../../lib/checkoutRoot";

export const CLI_SCRIPT = "argus-cli.js";

/** The CLI bundle next to the host bundle, or a checkout's `dist-host` build. */
export function cliScript(): string | null {
  return (
    [
      path.join(__dirname, CLI_SCRIPT),
      path.join(checkoutRoot(), "dist-host", CLI_SCRIPT),
    ].find((p) => fs.existsSync(p)) ?? null
  );
}

export function shimPath(home = argusHomeDir()): string {
  return path.join(home, "cli", "argus");
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export function shimSource(node: string, script: string, home: string): string {
  return [
    "#!/bin/sh",
    "# Written by Argus at launch. Runs the Argus that wrote it.",
    `ARGUS_HOME="\${ARGUS_HOME:-${home.replaceAll('"', '\\"').replaceAll("$", "\\$")}}" exec ${quote(node)} ${quote(script)} "$@"`,
    "",
  ].join("\n");
}

/** Returns the shim's path, or null when there is no CLI bundle to point at. */
export function writeCliShim(): string | null {
  const script = cliScript();
  if (!script) {
    return null;
  }
  const home = argusHomeDir();
  const file = shimPath(home);
  const source = shimSource(process.execPath, script, home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, "utf-8") === source) {
    return file;
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, source, { mode: 0o755 });
  fs.renameSync(tmp, file);

  return file;
}
