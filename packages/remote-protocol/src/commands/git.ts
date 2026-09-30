import type { CommandSpec } from "./spec";
import { GIT_BRANCH_COMMANDS } from "./git/branches";
import { GIT_HISTORY_COMMANDS } from "./git/history";
import { GIT_PROJECT_COMMANDS } from "./git/project";
import { GIT_REMOTE_COMMANDS } from "./git/remotes";
import { GIT_WORKING_COPY_COMMANDS } from "./git/workingCopy";

export const GIT_COMMANDS = {
  ...GIT_BRANCH_COMMANDS,
  ...GIT_WORKING_COPY_COMMANDS,
  ...GIT_HISTORY_COMMANDS,
  ...GIT_REMOTE_COMMANDS,
  ...GIT_PROJECT_COMMANDS,
} as const satisfies Record<string, CommandSpec>;
