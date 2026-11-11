/**
 * The access token Cursor's API accepts: `CURSOR_AUTH_TOKEN`, a traded-in
 * `CURSOR_API_KEY`, or the `cursor-agent login` sign-in. Read per request,
 * never stored or logged. Duplicates the lookup in `../planApis.ts`.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 10_000;

export const CURSOR_API = "https://api2.cursor.sh";

/** The Keychain on macOS, `auth.json` in the config dir elsewhere. */
async function loginToken(): Promise<string | null> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "security",
        [
          "find-generic-password",
          "-s",
          "cursor-access-token",
          "-a",
          "cursor-user",
          "-w",
        ],
        { timeout: TIMEOUT_MS },
      );
      if (stdout.trim()) {
        return stdout.trim();
      }
    } catch {
      // Not in the Keychain; try the file.
    }
  }
  const config =
    process.platform === "darwin"
      ? path.join(os.homedir(), ".cursor")
      : path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
          "cursor",
        );
  try {
    const parsed: unknown = JSON.parse(
      await fs.promises.readFile(path.join(config, "auth.json"), "utf8"),
    );
    const token =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { accessToken?: unknown }).accessToken
        : null;

    return typeof token === "string" && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

async function exchangeApiKey(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${CURSOR_API}/auth/exchange_user_api_key`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { accessToken?: unknown };

    return typeof body.accessToken === "string" && body.accessToken
      ? body.accessToken
      : null;
  } catch {
    return null;
  }
}

export async function cursorAccessToken(): Promise<string | null> {
  const token = process.env.CURSOR_AUTH_TOKEN?.trim();
  if (token) {
    return token;
  }
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  const exchanged = apiKey ? await exchangeApiKey(apiKey) : null;

  return exchanged ?? (await loginToken());
}
