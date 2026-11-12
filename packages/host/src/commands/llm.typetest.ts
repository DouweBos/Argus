import type { Equal, Expect } from "./typeEquality";
import type { CustomRunnerPreset as HostCustomRunnerPreset } from "../services/llm/customRunners/presets";
import type {
  CustomRunner as HostCustomRunner,
  CustomRunnerModel as HostCustomRunnerModel,
} from "../services/llm/customRunners/store";
import type { RegisteredRunner as HostRegisteredRunner } from "../services/llm/registry";
import type { RunnerAccount as HostRunnerAccount } from "../services/llm/runnerAccounts";
import type {
  RunnerCapabilities as HostRunnerCapabilities,
  RunnerModelOption as HostRunnerModelOption,
  RunnerSetup as HostRunnerSetup,
} from "../services/llm/runners/types";
import type {
  CustomRunner,
  CustomRunnerModel,
  CustomRunnerPreset,
  ParamsOf,
  RegisteredRunner,
  RunnerAccount,
  RunnerCapabilities,
  RunnerModelOption,
  RunnerSetup,
} from "@argus/remote-protocol";

export type LlmModelChecks = [
  Expect<Equal<RunnerCapabilities, HostRunnerCapabilities>>,
  Expect<Equal<RunnerModelOption, HostRunnerModelOption>>,
  Expect<Equal<RegisteredRunner, HostRegisteredRunner>>,
  Expect<Equal<RunnerSetup, HostRunnerSetup>>,
  Expect<Equal<RunnerAccount, HostRunnerAccount>>,
  Expect<Equal<CustomRunnerModel, HostCustomRunnerModel>>,
  Expect<Equal<CustomRunner, HostCustomRunner>>,
  Expect<Equal<CustomRunnerPreset, HostCustomRunnerPreset>>,
  Expect<
    Equal<
      ParamsOf<"llm_save_custom_runner">["runner"],
      Partial<HostCustomRunner>
    >
  >,
];
