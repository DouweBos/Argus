/**
 * Which Expo credential an EAS host uses: its saved token, then EXPO_TOKEN,
 * then the session `eas login` / `expo login` keep in `~/.expo/state.json`.
 * The secret stays in here and in request headers; everything that leaves
 * (errors, logs) goes through {@link scrub}.
 */

import type { ExpoCredentialSource } from "@argus/remote-protocol";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ExpoCredential {
  source: ExpoCredentialSource;
  header: { name: "authorization" | "expo-session"; value: string };
  /** The raw secret, so anything echoing it can be cut. */
  secret: string;
}

/** Why an EAS operation failed, for telemetry. Never carries text from Expo. */
export type EasFailure =
  | "api"
  | "auth_rejected"
  | "cancelled"
  | "invalid_credential"
  | "ledger"
  | "limit"
  | "network"
  | "no_app"
  | "no_credential"
  | "not_enabled"
  | "session_ended"
  | "stream"
  | "timeout";

export class EasError extends Error {
  constructor(
    readonly failure: EasFailure,
    message: string,
    /** Expo answered and refused, so a mutation did nothing. */
    readonly rejected = false,
    readonly status?: number,
  ) {
    super(message);
  }
}

const SOURCE_NAMES: Record<ExpoCredentialSource, string> = {
  settings: "The access token saved for this host",
  env: "EXPO_TOKEN",
  "eas-login": "The eas login session",
};

export interface CredentialEnv {
  env: NodeJS.ProcessEnv;
  home: string;
}

const defaultEnv = (): CredentialEnv => ({
  env: process.env,
  home: os.homedir(),
});

/**
 * Expo credentials are printable ASCII. Anything else (a pasted newline) would
 * fail inside fetch with the header value in its message, so it is refused here.
 */
function credential(
  source: ExpoCredentialSource,
  header: ExpoCredential["header"]["name"],
  secret: string,
): ExpoCredential {
  if (!/^[\x21-\x7e]+$/.test(secret)) {
    throw new EasError(
      "invalid_credential",
      `${SOURCE_NAMES[source]} is not a usable Expo credential. Replace it.`,
    );
  }

  return {
    source,
    secret,
    header: {
      name: header,
      value: header === "authorization" ? `Bearer ${secret}` : secret,
    },
  };
}

function easLoginSecret(home: string): string | null {
  try {
    const state = JSON.parse(
      fs.readFileSync(path.join(home, ".expo", "state.json"), "utf8"),
    ) as { auth?: { sessionSecret?: unknown } | null };
    const secret = state.auth?.sessionSecret;

    return typeof secret === "string" && secret.trim() ? secret.trim() : null;
  } catch {
    return null;
  }
}

export function resolveExpoCredential(
  savedToken: string,
  where: CredentialEnv = defaultEnv(),
): ExpoCredential {
  const saved = savedToken.trim();
  if (saved) {
    return credential("settings", "authorization", saved);
  }
  const fromEnv = where.env.EXPO_TOKEN?.trim();
  if (fromEnv) {
    return credential("env", "authorization", fromEnv);
  }
  const session = easLoginSecret(where.home);
  if (session) {
    return credential("eas-login", "expo-session", session);
  }
  throw new EasError(
    "no_credential",
    "No Expo credential: save an access token for this host, set EXPO_TOKEN for the Argus host, or run `eas login`.",
  );
}

/** Cut every secret out of `text` and bound it. */
export function scrub(
  text: string,
  ...secrets: (string | undefined)[]
): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join("[redacted]");
    }
  }

  return out.slice(0, 300);
}
