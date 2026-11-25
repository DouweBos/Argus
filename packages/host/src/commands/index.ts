/**
 * Every command the host core serves, registered against the catalog in
 * `@argus/remote-protocol`. The desktop shell adds its window- and
 * dialog-bound commands on top; a headless host runs with these alone.
 */

import { registerAccountCommands } from "./account";
import { registerAgentCommands } from "./agents";
import { registerAutomationCommands } from "./automations";
import { registerBlueprintCommands } from "./blueprints";
import { registerBrowserCommands } from "./browser";
import { registerCloneCommands } from "./clone";
import { registerCodeCommands } from "./code";
import { registerDeviceCommands } from "./devices";
import { registerFileCommands } from "./files";
import { registerGitCommands } from "./git";
import { registerGitRunnerCommands } from "./gitRunner";
import { registerGithubCommands } from "./github";
import { registerIntegrationCommands } from "./integrations";
import { registerLlmCommands } from "./llm";
import { registerLspCommands } from "./lsp";
import { registerMcpCommands } from "./mcp";
import { registerOnboardingCommands } from "./onboarding";
import { registerRemoteCommands } from "./remote";
import { registerSessionCommands } from "./sessions";
import { registerSettingsCommands } from "./settings";
import { registerSlackCommands } from "./slack";
import { registerTeammateCommands } from "./teammates";
import { registerTerminalCommands } from "./terminals";
import { registerUsageCommands } from "./usage";

export function registerHostCommands(): void {
  registerFileCommands();
  registerCodeCommands();
  registerLspCommands();
  registerGitCommands();
  registerSessionCommands();
  registerAgentCommands();
  registerTerminalCommands();
  registerAutomationCommands();
  registerBlueprintCommands();
  registerCloneCommands();
  registerOnboardingCommands();
  registerSettingsCommands();
  registerLlmCommands();
  registerDeviceCommands();
  registerBrowserCommands();
  registerRemoteCommands();
  registerMcpCommands();
  registerGithubCommands();
  registerGitRunnerCommands();
  registerUsageCommands();
  registerAccountCommands();
  registerIntegrationCommands();
  registerSlackCommands();
  registerTeammateCommands();
}
