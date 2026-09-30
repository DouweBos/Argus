import { registerGitBranchCommands } from "./git/branches";
import { registerGitHistoryCommands } from "./git/history";
import { registerGitProjectCommands } from "./git/project";
import { registerGitRemoteCommands } from "./git/remotes";
import { registerGitWorkingCopyCommands } from "./git/workingCopy";

export function registerGitCommands(): void {
  registerGitBranchCommands();
  registerGitWorkingCopyCommands();
  registerGitHistoryCommands();
  registerGitRemoteCommands();
  registerGitProjectCommands();
}
