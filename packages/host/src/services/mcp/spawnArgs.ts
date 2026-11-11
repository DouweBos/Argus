/** Arguments shared by the tools that start an agent. */

import { z } from "zod";
import { TOOL_IDS } from "../tools/types";

/**
 * Reusable required `project_path` argument for session-scoped tools. Agents
 * typically reference a session by branch or display name, neither of which is
 * unique across projects — the project scopes the lookup so a shared name
 * can't resolve to the wrong project's session.
 */
export const sessionProjectPathArg = z
  .string()
  .describe(
    "Absolute path to the project root the session belongs to. Use the project_path from your system prompt for the current project, or a path from list_projects for another. Required: branch and display names are only unique within a project.",
  );

export const devicesArg = z
  .array(z.string())
  .optional()
  .describe(
    "Devices to hand this agent for the run — simulator UDIDs or names, Android serials (from `conductor list-devices`). Its system prompt lists them and no other agent gets them; use it for a device matrix such as an iPhone plus an iPad instead of naming UDIDs in the prompt.",
  );

export const toolsArg = z
  .object({ disabled: z.array(z.enum(TOOL_IDS)).optional() })
  .optional()
  .describe(
    'Tool profile for this agent: `{ disabled: ["device-control"] }` runs it without devices — no device guide in its prompt, `conductor` and `design_compare` refused. On top of the app and project Tools settings, which it can only narrow.',
  );

export const permissionModeArg = z
  .enum(["default", "auto", "acceptEdits", "bypassPermissions", "plan"])
  .optional()
  .describe(
    "Permission mode for the agent. 'auto' uses Claude's smart classifier to auto-approve safe actions and ask for risky ones. 'default' prompts per tool; 'acceptEdits' auto-accepts file edits; 'plan' is read-only exploration plus AskUserQuestion/ExitPlanMode requiring an approved plan before writes; 'bypassPermissions' skips all prompts. Defaults to the app's setting.",
  );

export const modelArg = z
  .string()
  .optional()
  .describe(
    "Optional model id override for this agent (runner-specific shape). When omitted the cascade falls through to the session, project, and app defaults — set this only when delegating a child to a different model than its parent. The session's runner is fixed at session creation and is *not* overridable here.",
  );
