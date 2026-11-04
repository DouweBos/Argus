/**
 * The Mac app's debug `DevDriver` (`ARGUS_DEV_DRIVER=<dir>`), from the outside:
 * drop a `cmd-<n>.json`, wait for its `out-<n>.json`. Everything it does
 * happens inside our own process, so nothing else on screen is touched.
 */

import fs from "node:fs";
import path from "node:path";

export class DevDriver {
  private next = 0;

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  async run(
    command: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<Record<string, unknown>> {
    this.next += 1;
    // Zero-padded: the driver runs them in name order.
    const id = String(this.next).padStart(5, "0");
    const out = path.join(this.dir, `out-${id}.json`);
    const tmp = path.join(this.dir, `.cmd-${id}.json`);
    fs.writeFileSync(tmp, JSON.stringify(command));
    fs.renameSync(tmp, path.join(this.dir, `cmd-${id}.json`));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(out)) {
        // Written in one go, but give a partial write a beat to land.
        try {
          const result = JSON.parse(fs.readFileSync(out, "utf8")) as Record<
            string,
            unknown
          >;
          fs.rmSync(out, { force: true });

          return result;
        } catch {
          // still being written
        }
      }
      await sleep(50);
    }
    throw new Error(`dev driver timed out on ${JSON.stringify(command)}`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
