import { z } from "zod";
import {
  ArgusConfigSuggestion,
  ClaudeAccountsState,
  ClaudeAuthStatus,
  ClaudeLoginUrl,
  ConductorImport,
  ExampleProject,
  OkOrError,
  OnboardingConfigFile,
  OnboardingStep,
  PrereqId,
  PrereqResult,
} from "../models/onboarding";
import { type CommandSpec, NoParams, Void } from "./spec";

const RepoPath = z.object({ path: z.string() });
const AccountId = z.object({ id: z.string() });
/** `.argus.json` contents; the config's own schema lives with the sessions. */
const ArgusConfigBlob = z.record(z.string(), z.unknown());

export const ONBOARDING_COMMANDS = {
  onboarding_get_state: {
    tier: "admin",
    params: NoParams,
    result: OnboardingConfigFile,
  },
  onboarding_ensure_argus_dir: {
    tier: "admin",
    params: NoParams,
    result: z.object({ path: z.string() }),
  },
  onboarding_set_last_step: {
    tier: "admin",
    params: z.object({ step: OnboardingStep }),
    result: Void,
  },
  onboarding_add_skipped: {
    tier: "admin",
    params: z.object({ id: z.string() }),
    result: Void,
  },
  /**
   * Runs the given checks (all when omitted). Progress streams as
   * `onboarding:prereq_update` events; the final results resolve here.
   */
  onboarding_check_prereqs: {
    tier: "admin",
    params: z.object({ ids: z.array(PrereqId).optional() }),
    result: z.array(PrereqResult),
  },
  onboarding_run_fixer: {
    tier: "admin",
    params: z.object({
      id: PrereqId,
      gitName: z.string().optional(),
      gitEmail: z.string().optional(),
    }),
    result: OkOrError,
  },
  onboarding_claude_ping: {
    tier: "admin",
    params: NoParams,
    result: OkOrError,
  },
  claude_auth_status: {
    tier: "admin",
    params: z.object({ accountId: z.string().optional() }),
    result: ClaudeAuthStatus,
  },
  claude_auth_logout: {
    tier: "admin",
    params: z.object({ accountId: z.string().optional() }),
    result: Void,
  },
  claude_auth_login_start: {
    tier: "admin",
    params: z.object({
      useConsole: z.boolean().optional(),
      accountId: z.string().optional(),
    }),
    result: ClaudeLoginUrl,
  },
  claude_accounts_list: {
    tier: "admin",
    params: NoParams,
    result: ClaudeAccountsState,
  },
  claude_accounts_set_active: {
    tier: "admin",
    params: AccountId,
    result: z.null(),
  },
  /** Sign in an additional account without disturbing the ones signed in. */
  claude_accounts_add: {
    tier: "admin",
    params: z.object({ useConsole: z.boolean().optional() }),
    result: ClaudeLoginUrl,
  },
  claude_accounts_remove: {
    tier: "admin",
    params: AccountId,
    result: z.null(),
  },
  claude_accounts_rename: {
    tier: "admin",
    params: AccountId.extend({ label: z.string() }),
    result: z.null(),
  },
  claude_accounts_refresh: {
    tier: "admin",
    params: AccountId,
    result: z.null(),
  },
  claude_auth_login_submit_code: {
    tier: "admin",
    params: z.object({ code: z.string() }),
    result: OkOrError,
  },
  claude_auth_login_cancel: {
    tier: "admin",
    params: NoParams,
    result: z.null(),
  },
  onboarding_list_examples: {
    tier: "admin",
    params: NoParams,
    result: z.array(ExampleProject),
  },
  onboarding_clone_example: {
    tier: "admin",
    params: z.object({ slug: z.string() }),
    result: z.object({ path: z.string() }),
  },
  onboarding_register_project: {
    tier: "admin",
    params: RepoPath,
    result: Void,
  },
  onboarding_suggest_argus_json: {
    tier: "admin",
    params: RepoPath,
    result: ArgusConfigSuggestion,
  },
  /** Null when the repo has no Conductor config. */
  onboarding_import_conductor_config: {
    tier: "admin",
    params: RepoPath,
    result: ConductorImport.nullable(),
  },
  onboarding_read_existing_argus_json: {
    tier: "admin",
    params: RepoPath,
    result: ArgusConfigBlob.nullable(),
  },
  onboarding_refine_argus_json_with_claude: {
    tier: "admin",
    params: RepoPath.extend({ config: ArgusConfigBlob }),
    result: ArgusConfigBlob,
  },
  /** Writes `.argus.json` to the repo root (backing up any existing one). */
  onboarding_write_argus_json: {
    tier: "admin",
    params: RepoPath.extend({ config: ArgusConfigBlob }),
    result: Void,
  },
  onboarding_complete: { tier: "admin", params: NoParams, result: Void },
  onboarding_reset: { tier: "admin", params: NoParams, result: Void },
  onboarding_argus_dir_path: {
    tier: "admin",
    params: NoParams,
    result: z.string(),
  },
} as const satisfies Record<string, CommandSpec>;
