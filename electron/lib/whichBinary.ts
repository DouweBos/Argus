/**
 * Cross-platform binary resolution on PATH.
 *
 * Uses `where` on Windows and `which` elsewhere — `which` doesn't exist on
 * Windows. Returns the absolute path of the first match, or `null` when the
 * binary isn't found. A non-zero exit means "not on PATH", not a probe
 * failure, so errors are swallowed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function resolveBinaryOnPath(
  binary: string,
): Promise<string | null> {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(cmd, [binary]);
    const resolved = stdout.split(/\r?\n/)[0]?.trim();

    return resolved ? resolved : null;
  } catch {
    return null;
  }
}
