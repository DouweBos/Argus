/**
 * `argus` — start, message and read Argus agents from a terminal or a script,
 * through the running host's MCP server. See `docs/cli.md`.
 */

import { parseArgs, UsageError } from "../services/cli/argus/args";
import {
  connectToHost,
  HostUnreachable,
  projectRoot,
  readStdin,
} from "../services/cli/argus/connect";
import { EXIT, runCli } from "../services/cli/argus/run";

async function main(): Promise<number> {
  let cmd;
  try {
    cmd = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`argus: ${e.message}\n`);

      return EXIT.usage;
    }
    throw e;
  }

  const out = (t: string) => process.stdout.write(`${t}\n`);
  const err = (t: string) => process.stderr.write(`${t}\n`);
  const version = process.env.ARGUS_VERSION ?? "dev";
  if (cmd.kind === "help" || cmd.kind === "version") {
    return runCli(cmd, {
      call: () => Promise.reject(new Error("unused")),
      out,
      err,
      readStdin,
      projectRoot,
      version,
    });
  }

  let host;
  try {
    host = await connectToHost();
  } catch (e) {
    if (e instanceof HostUnreachable) {
      err(`argus: ${e.message}`);

      return EXIT.unreachable;
    }
    throw e;
  }
  try {
    return await runCli(cmd, {
      call: host.call,
      out,
      err,
      readStdin,
      projectRoot,
      version,
    });
  } finally {
    await host.close().catch(() => {});
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`argus: ${String(e)}\n`);
    process.exit(EXIT.failed);
  },
);
