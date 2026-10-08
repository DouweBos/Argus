/**
 * Every command the host core serves, registered against the catalog in
 * `@argus/remote-protocol`. The desktop shell adds its window- and
 * dialog-bound commands on top; a headless host runs with these alone.
 */

import { registerAgentCommands } from "./agents";
import { registerAutomationCommands } from "./automations";
import { registerBrowserCommands } from "./browser";
import { registerCodeCommands } from "./code";
import { registerDeviceCommands } from "./devices";
import { registerFileCommands } from "./files";
import { registerGitCommands } from "./git";
import { registerGitRunnerCommands } from "./gitRunner";
import { registerGithubCommands } from "./github";
import { registerLlmCommands } from "./llm";
import { registerLspCommands } from "./lsp";
import { registerMcpCommands } from "./mcp";
import { registerOnboardingCommands } from "./onboarding";
import { registerRemoteCommands } from "./remote";
import { registerSessionCommands } from "./sessions";
import { registerSettingsCommands } from "./settings";
import { registerTerminalCommands } from "./terminals";

export function registerHostCommands(): void {
  registerFileCommands();
  registerCodeCommands();
  registerLspCommands();
  registerGitCommands();
  registerSessionCommands();
  registerAgentCommands();
  registerTerminalCommands();
  registerAutomationCommands();
  registerOnboardingCommands();
  registerSettingsCommands();
  registerLlmCommands();
  registerDeviceCommands();
  registerBrowserCommands();
  registerRemoteCommands();
  registerMcpCommands();
  registerGithubCommands();
  registerGitRunnerCommands();
}
