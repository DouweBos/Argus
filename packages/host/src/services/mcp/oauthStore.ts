/**
 * Persisted OAuth tokens for MCP servers.
 *
 * Tokens are encrypted with the host's secret storage (a key in the login
 * keychain on macOS) and stored as base64 inside `~/.argus/mcp-tokens.json`.
 * The file is keyed by the canonical resource URL of the MCP server.
 *
 * If secret storage is unavailable on the host, we fall back to plaintext
 * with a warning — better than refusing to authenticate at all.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { isNodeSecretBlob } from "../../lib/nodeSecretStorage";
import { argusDirPath } from "../onboarding/state";
import {
  legacySecretStoreMessage,
  secretStorageFor,
  usesLegacySecretStorage,
} from "../secrets/legacyStores";

export interface StoredMcpToken {
  /** Canonical MCP server URL this token belongs to. */
  resource: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token stops being valid. Optional. */
  expiresAt?: number;
  /** Endpoints kept around so we can refresh without re-discovering. */
  tokenEndpoint: string;
  authorizationEndpoint: string;
  /** Dynamic-registration client_id used to obtain this token. */
  clientId: string;
  /** Dynamic-registration client_secret, when one was issued. */
  clientSecret?: string;
  /**
   * Token-endpoint auth method the client was issued with, e.g.
   * `client_secret_basic`. Decides how the secret is presented on refresh.
   */
  clientAuthMethod?: string;
  /** Scopes actually granted (server may narrow what we asked for). */
  scope?: string;
}

interface FileShape {
  // Each value is either a base64-encoded encrypted blob (preferred) or a
  // plaintext fallback object. Distinguished by the `enc` flag.
  servers: Record<
    string,
    { data: StoredMcpToken; enc: false } | { data: string; enc: true }
  >;
}

function tokensPath(): string {
  return path.join(argusDirPath(), "mcp-tokens.json");
}

async function readFile(): Promise<FileShape> {
  try {
    const raw = await fs.readFile(tokensPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<FileShape>;

    return { servers: parsed.servers ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { servers: {} };
    }
    warn(`[mcp-oauth] failed to read tokens file: ${(err as Error).message}`);

    return { servers: {} };
  }
}

async function writeFile(file: FileShape): Promise<void> {
  await fs.mkdir(argusDirPath(), { recursive: true });
  await fs.writeFile(tokensPath(), JSON.stringify(file, null, 2), {
    mode: 0o600,
  });
}

/**
 * Normalize an MCP server URL into the canonical form used as a token key.
 * Strips the fragment, trailing slash, and lowercases scheme + host.
 */
export function canonicalResource(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    u.protocol = u.protocol.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/") && !u.pathname.endsWith("//")) {
      s = s.slice(0, -1);
    }

    return s;
  } catch {
    return url;
  }
}

export async function loadToken(
  resource: string,
): Promise<StoredMcpToken | null> {
  const key = canonicalResource(resource);
  const file = await readFile();
  const entry = file.servers[key];
  if (!entry) {
    return null;
  }
  if (entry.enc) {
    const blob = Buffer.from(entry.data, "base64");
    if (!isNodeSecretBlob(blob) && !usesLegacySecretStorage("mcp_tokens")) {
      warn(`[mcp-oauth] ${legacySecretStoreMessage("MCP sign-ins")}`);

      return null;
    }
    if (!secretStorageFor("mcp_tokens").isAvailable()) {
      warn(
        "[mcp-oauth] encryption unavailable but token is encrypted; cannot decrypt",
      );

      return null;
    }
    try {
      const json = secretStorageFor("mcp_tokens").decrypt(blob);

      return JSON.parse(json) as StoredMcpToken;
    } catch (err) {
      warn(`[mcp-oauth] failed to decrypt token: ${(err as Error).message}`);

      return null;
    }
  }

  return entry.data;
}

export async function saveToken(token: StoredMcpToken): Promise<void> {
  const key = canonicalResource(token.resource);
  const file = await readFile();
  if (secretStorageFor("mcp_tokens").isAvailable()) {
    const buf = secretStorageFor("mcp_tokens").encrypt(JSON.stringify(token));
    file.servers[key] = { enc: true, data: buf.toString("base64") };
  } else {
    warn(
      "[mcp-oauth] secret storage unavailable — writing token in plaintext to ~/.argus/mcp-tokens.json",
    );
    file.servers[key] = { enc: false, data: token };
  }
  await writeFile(file);
}

export async function deleteToken(resource: string): Promise<void> {
  const key = canonicalResource(resource);
  const file = await readFile();
  if (file.servers[key]) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete file.servers[key];
    await writeFile(file);
  }
}

export async function listAuthorized(): Promise<string[]> {
  const file = await readFile();

  return Object.keys(file.servers);
}
