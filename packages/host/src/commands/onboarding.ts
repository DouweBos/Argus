import type { PrereqResult } from "../services/onboarding/types";
import { emitHostEvent } from "@argus/host/bus";
import {
  forgetClaudeAccount,
  listClaudeAccountsState,
  relabelClaudeAccount,
  switchClaudeAccount,
} from "../services/claudeAuth/accountActions";
import {
  claudeAddAccount,
  claudeLoginCancel,
  claudeLoginStart,
  claudeLoginSubmitCode,
  claudeLogout,
  claudeRefreshAccount,
  getClaudeAuthStatus,
} from "../services/claudeAuth/claudeAuth";
import { defineTypedCommand } from "../services/command/registry";
import {
  addSkipped,
  argusDirPath,
  claudePing,
  cloneExample,
  completeOnboarding,
  ensureArgusDir,
  getOnboardingState,
  listExamples,
  readExistingArgusJson,
  refineArgusJsonWithClaude,
  registerProject,
  resetOnboarding,
  runPrereqChecks,
  runPrereqFixer,
  setLastStep,
  suggestArgusJson,
  writeArgusJson,
} from "../services/onboarding/index";

function emitPrereqUpdate(update: PrereqResult): void {
  emitHostEvent("onboarding:prereq_update", update);
}

export function registerOnboardingCommands(): void {
  defineTypedCommand("onboarding_get_state", () => getOnboardingState());
  defineTypedCommand("onboarding_ensure_argus_dir", () => ({
    path: ensureArgusDir(),
  }));
  defineTypedCommand("onboarding_set_last_step", (p) => setLastStep(p.step));
  defineTypedCommand("onboarding_add_skipped", (p) => addSkipped(p.id));
  defineTypedCommand("onboarding_check_prereqs", (p) =>
    runPrereqChecks(emitPrereqUpdate, p.ids),
  );
  defineTypedCommand("onboarding_run_fixer", (p) =>
    runPrereqFixer(
      p.id,
      { gitName: p.gitName, gitEmail: p.gitEmail },
      emitPrereqUpdate,
    ),
  );
  defineTypedCommand("onboarding_claude_ping", () => claudePing());

  defineTypedCommand("claude_auth_status", (p) =>
    getClaudeAuthStatus(p.accountId),
  );
  defineTypedCommand("claude_auth_logout", (p) => claudeLogout(p.accountId));
  defineTypedCommand("claude_auth_login_start", (p) =>
    claudeLoginStart({ useConsole: p.useConsole, accountId: p.accountId }),
  );
  defineTypedCommand("claude_accounts_list", () => listClaudeAccountsState());
  defineTypedCommand("claude_accounts_set_active", (p) => {
    switchClaudeAccount(p.id);

    return null;
  });
  defineTypedCommand("claude_accounts_add", (p) =>
    claudeAddAccount({ useConsole: p.useConsole }),
  );
  defineTypedCommand("claude_accounts_remove", async (p) => {
    await forgetClaudeAccount(p.id);

    return null;
  });
  defineTypedCommand("claude_accounts_rename", (p) => {
    relabelClaudeAccount(p.id, p.label);

    return null;
  });
  defineTypedCommand("claude_accounts_refresh", async (p) => {
    await claudeRefreshAccount(p.id);

    return null;
  });
  defineTypedCommand("claude_auth_login_submit_code", (p) =>
    claudeLoginSubmitCode({ code: p.code }),
  );
  defineTypedCommand("claude_auth_login_cancel", () => {
    claudeLoginCancel();

    return null;
  });

  defineTypedCommand("onboarding_list_examples", () => listExamples());
  defineTypedCommand("onboarding_clone_example", (p) => cloneExample(p.slug));
  defineTypedCommand("onboarding_register_project", (p) =>
    registerProject(p.path),
  );
  defineTypedCommand("onboarding_suggest_argus_json", (p) =>
    suggestArgusJson(p.path),
  );
  defineTypedCommand("onboarding_read_existing_argus_json", (p) =>
    readExistingArgusJson(p.path),
  );
  defineTypedCommand("onboarding_refine_argus_json_with_claude", (p) =>
    refineArgusJsonWithClaude(p.path, p.config),
  );
  defineTypedCommand("onboarding_write_argus_json", (p) =>
    writeArgusJson(p.path, p.config),
  );
  defineTypedCommand("onboarding_complete", () => completeOnboarding());
  defineTypedCommand("onboarding_reset", () => resetOnboarding());
  defineTypedCommand("onboarding_argus_dir_path", () => argusDirPath());
}
