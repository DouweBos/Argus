/**
 * An ACP session's settings: the agent's modes, models and config options,
 * and how an Argus mode or model pick maps onto them.
 */

import type { AcpPreset } from "./preset";
import type {
  AcpConfigOption,
  AcpConfigSelectOption,
  AcpMode,
  AcpModelInfo,
  AcpSessionResult,
} from "./protocol";
import type { JsonRpcPeer } from "../rpc";
import type { CanonicalPermissionMode } from "../types";
import { warn } from "@argus/host/logger";

export class AcpSessionSettings {
  private readonly modes: AcpMode[];
  private agentModeId: string | null;
  private readonly initialModeId: string | null;
  private readonly models: AcpModelInfo[];
  private readonly initialModelId: string | null;
  private config: AcpConfigOption[];

  constructor(
    private readonly rpc: JsonRpcPeer,
    private readonly preset: AcpPreset,
    private readonly sessionId: string,
    private readonly agentId: string,
    session: AcpSessionResult,
  ) {
    this.modes = session.modes?.availableModes ?? [];
    this.agentModeId = session.modes?.currentModeId ?? null;
    this.initialModeId = this.agentModeId;
    this.models = session.models?.availableModels ?? [];
    this.initialModelId = session.models?.currentModelId ?? null;
    this.config = session.configOptions ?? [];
  }

  /** The model the agent is on, as far as it has said. */
  currentModel(): string | null {
    const value = this.modelOption()?.currentValue;

    return typeof value === "string" ? value : this.initialModelId;
  }

  modelChoices(): AcpConfigSelectOption[] {
    const option = this.modelOption();
    if (option) {
      return (option.options ?? []).flatMap((o) =>
        "options" in o ? o.options : [o],
      );
    }

    return this.models.map((m) => ({
      value: m.modelId,
      name: m.name,
      description: m.description,
    }));
  }

  hasPlanMode(): boolean {
    return this.planModeId() !== null;
  }

  noteMode(modeId: string): void {
    this.agentModeId = modeId;
  }

  noteConfig(options: AcpConfigOption[]): void {
    this.config = options;
  }

  async applyModel(model: string): Promise<void> {
    const option = this.modelOption();
    if (option) {
      await this.setConfig(option.id, model);
    } else if (this.models.length > 0) {
      await this.rpc.request("session/set_model", {
        sessionId: this.sessionId,
        modelId: model,
      });
    }
  }

  /** The agent's own mode for this Argus mode, and any config it pairs with. */
  async applyMode(mode: CanonicalPermissionMode): Promise<void> {
    const target = this.targetModeId(mode);
    if (target && target !== this.agentModeId) {
      try {
        await this.rpc.request("session/set_mode", {
          sessionId: this.sessionId,
          modeId: target,
        });
        this.agentModeId = target;
      } catch (e) {
        warn(`[agent:${this.agentId}] acp set mode failed: ${String(e)}`);
      }
    }
    for (const [id, value] of Object.entries(
      this.preset.configFor?.(mode) ?? {},
    )) {
      if (this.config.some((o) => o.id === id)) {
        await this.setConfig(id, value).catch((e) =>
          warn(`[agent:${this.agentId}] acp set ${id} failed: ${String(e)}`),
        );
      }
    }
  }

  private modelOption(): AcpConfigOption | null {
    return (
      this.config.find((o) => o.category === "model" && o.type === "select") ??
      null
    );
  }

  private targetModeId(mode: CanonicalPermissionMode): string | null {
    const preset = this.preset.modeIds?.[mode];
    if (preset && this.modes.some((m) => m.id === preset)) {
      return preset;
    }
    const plan = this.planModeId();
    if (mode === "plan") {
      return plan;
    }

    // Leaving plan mode puts the agent back where it started.
    return plan && this.agentModeId === plan ? this.initialModeId : null;
  }

  private planModeId(): string | null {
    return (
      this.modes.find((m) => /(^|[#/])plan$/i.test(m.id))?.id ??
      this.modes.find((m) => /plan/i.test(m.name))?.id ??
      null
    );
  }

  private async setConfig(configId: string, value: string): Promise<void> {
    const res = await this.rpc.request<{ configOptions?: AcpConfigOption[] }>(
      "session/set_config_option",
      { sessionId: this.sessionId, configId, value },
    );
    if (res?.configOptions) {
      this.config = res.configOptions;
    }
  }
}
