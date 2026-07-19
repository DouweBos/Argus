/**
 * Discovery for the Android emulator's gRPC endpoint.
 *
 * A running emulator writes a `pid_<pid>.ini` file into its registration
 * directory containing `port.serial` (adb serial), `grpc.port`, and optionally
 * `grpc.token`. We parse these to find the gRPC endpoint for a given adb
 * serial (e.g. "emulator-5554").
 *
 * See qemu `android/emulation/ConfigDirs` for the registration directory
 * resolution this mirrors.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface EmulatorGrpcEndpoint {
  /** gRPC token (Bearer). Falls back to ~/.emulator_console_auth_token. */
  token: string | null;
  port: number;
}

/** Candidate "avd/running" directories where discovery files may live. */
function discoveryDirs(): string[] {
  const dirs: string[] = [];
  const emuHome = process.env.ANDROID_EMULATOR_HOME;
  if (emuHome) {
    dirs.push(emuHome);
  }
  if (process.platform === "darwin") {
    dirs.push(path.join(os.homedir(), "Library", "Caches", "TemporaryItems"));
  } else if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      dirs.push(path.join(local, "Temp"));
    }
  } else {
    const xdg = process.env.XDG_RUNTIME_DIR;
    if (xdg) {
      dirs.push(xdg);
    }
    dirs.push(`/run/user/${String(process.getuid?.() ?? "")}`);
    dirs.push(path.join(os.homedir(), ".android"));
  }
  if (process.env.TMPDIR) {
    dirs.push(process.env.TMPDIR);
  }

  return dirs.map((d) => path.join(d, "avd", "running"));
}

function parseIni(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }

  return out;
}

/** Read the console/gRPC auth token, if present. */
function readAuthToken(): string | null {
  try {
    const p = path.join(os.homedir(), ".emulator_console_auth_token");
    const token = fs.readFileSync(p, "utf8").trim();

    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Find the gRPC endpoint for the emulator with the given adb serial
 * (e.g. "emulator-5554"). Returns null if no matching discovery file exists.
 */
export function discoverEmulatorGrpc(
  serial: string,
): EmulatorGrpcEndpoint | null {
  // adb serial "emulator-5554" → console serial port 5554
  const serialPort = /^emulator-(\d+)$/.exec(serial)?.[1] ?? null;
  const fallbackToken = readAuthToken();

  for (const dir of discoveryDirs()) {
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.startsWith("pid_") || !file.endsWith(".ini")) {
        continue;
      }
      let ini: Record<string, string>;
      try {
        ini = parseIni(fs.readFileSync(path.join(dir, file), "utf8"));
      } catch {
        continue;
      }
      const grpcPort = ini["grpc.port"];
      if (!grpcPort) {
        continue;
      }
      // Match by console serial when we can; otherwise accept the sole entry.
      if (
        serialPort &&
        ini["port.serial"] &&
        ini["port.serial"] !== serialPort
      ) {
        continue;
      }

      return {
        port: parseInt(grpcPort, 10),
        token: ini["grpc.token"] || fallbackToken,
      };
    }
  }

  return null;
}
