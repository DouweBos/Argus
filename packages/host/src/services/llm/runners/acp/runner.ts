/**
 * A runner for any agent that speaks the Agent Client Protocol: one class,
 * configured by an {@link AcpPreset} per vendor (Gemini CLI, Antigravity,
 * Kiro, ...).
 *
 * No transcript fork or side questions: both lean on Claude Code's on-disk
 * transcript, and the capabilities say so.
 */

import type { AcpPreset } from "./preset";
import type {
  LlmRunner,
  LlmRunnerHandle,
  LlmRunnerSpawnArgs,
  OneShotArgs,
  PreflightResult,
  RunnerAuthProbe,
  RunnerCapabilities,
  RunnerSetup,
} from "../types";
import { spawn } from "node:child_process";
import { info } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { resolveBinary } from "../../../dependencies/check";
import { type AuthProbeSpec, runAuthProbe } from "../authProbe";
import { AcpHandle } from "./handle";
import { runAcpOneShot } from "./oneShot";

export class AcpRunner implements LlmRunner {
  readonly id: string;
  readonly displayName: string;
  /** Only when the preset knows how to ask, so "can't tell" stays distinguishable. */
  readonly authStatus?: () => Promise<RunnerAuthProbe>;

  constructor(private readonly preset: AcpPreset) {
    this.id = preset.id;
    this.displayName = preset.displayName;
    const spec = preset.authStatus;
    if (spec) {
      this.authStatus = () => this.probeAuth(spec);
    }
  }

  capabilities(): RunnerCapabilities {
    return {
      supportsMcp: true,
      supportsTranscriptFork: false,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: false,
      supportsInterrupt: true,
      supportsSideQuestion: false,
    };
  }

  async preflight(): Promise<PreflightResult> {
    for (const bin of this.preset.bins) {
      const resolved = await resolveBinary(bin);
      if (resolved) {
        return { ok: true, binPath: resolved };
      }
    }

    return {
      ok: false,
      reason: `${this.displayName} isn't installed. ${this.preset.installHint}`,
    };
  }

  setup(): RunnerSetup {
    return {
      installCommand: this.preset.installCommand ?? null,
      installUrl: this.preset.installUrl ?? null,
      loginCommand: this.preset.loginCommand ?? null,
      logoutCommand: this.preset.logoutCommand ?? null,
    };
  }

  private async probeAuth(spec: AuthProbeSpec): Promise<RunnerAuthProbe> {
    const pre = await this.preflight();

    return pre.ok
      ? runAuthProbe(
          pre.binPath,
          spec,
          withOverrides(process.env, this.preset.env),
        )
      : { signedIn: null, account: null };
  }

  async spawn(args: LlmRunnerSpawnArgs): Promise<LlmRunnerHandle> {
    const handle = await this.start({
      agentId: args.agentId,
      cwd: args.cwd,
      env: args.env,
      model: args.model,
      permissionMode: args.permissionMode,
      resumeRef: args.resumeRef,
      systemPrompt: args.systemPrompt,
      mcpServers: args.mcpServers,
      permissionPreHook: args.permissionPreHook,
      disallowedTools: args.disallowedTools,
    });
    info(`[agent:${args.agentId}] spawned ${this.id} over acp`);

    return handle;
  }

  async oneShot(args: OneShotArgs): Promise<string | null> {
    return runAcpOneShot(this.displayName, args, (init) => this.start(init));
  }

  private async start(
    init: Omit<
      ConstructorParameters<typeof AcpHandle>[0],
      "child" | "clientVersion" | "preset"
    > & { env?: NodeJS.ProcessEnv },
  ): Promise<AcpHandle> {
    const pre = await this.preflight();
    if (!pre.ok) {
      throw pre.reason;
    }
    const argv =
      typeof this.preset.args === "function"
        ? await this.preset.args(pre.binPath)
        : this.preset.args;
    const { env, ...rest } = init;
    const child = spawn(pre.binPath, argv, {
      cwd: init.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: withOverrides(env ?? process.env, this.preset.env),
    });

    return new AcpHandle({
      ...rest,
      child,
      preset: this.preset,
      clientVersion: hostPlatform().appVersion(),
    });
  }
}

/** Overrides win over inherited vars; an empty value unsets one. */
function withOverrides(
  base: NodeJS.ProcessEnv,
  overrides: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === "") {
      Reflect.deleteProperty(env, key);
    } else {
      env[key] = value;
    }
  }

  return env;
}
