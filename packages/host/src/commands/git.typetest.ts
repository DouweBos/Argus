import type { Equal, Expect } from "./typeEquality";
import type {
  BisectStatus as HostBisectStatus,
  BisectStep as HostBisectStep,
} from "../services/session/gitBisect";
import type { BlameChunk as HostBlameChunk } from "../services/session/gitBlame";
import type {
  BranchCommitSummary as HostBranchCommitSummary,
  EnrichedBranch as HostEnrichedBranch,
  RemoteBranch as HostRemoteBranch,
} from "../services/session/gitBranchOps";
import type { CompareResult as HostCompareResult } from "../services/session/gitCompare";
import type { ConflictBlobs as HostConflictBlobs } from "../services/session/gitConflicts";
import type { SshKey as HostSshKey } from "../services/session/gitCredentials";
import type {
  Hook as HostHook,
  HookOutput as HostHookOutput,
} from "../services/session/gitHooks";
import type { LfsFiles as HostLfsFiles } from "../services/session/gitLfs";
import type { FormatPatchResult as HostFormatPatchResult } from "../services/session/gitPatches";
import type {
  PullV2Opts as HostPullV2Opts,
  PushV2Opts as HostPushV2Opts,
} from "../services/session/gitPushPull";
import type {
  RebasePlanCommit as HostRebasePlanCommit,
  RebasePlanEntry as HostRebasePlanEntry,
} from "../services/session/gitRebase";
import type {
  ReflogEntry as HostReflogEntry,
  ReflogOptions as HostReflogOptions,
} from "../services/session/gitReflog";
import type { Remote as HostRemote } from "../services/session/gitRemoteOps";
import type {
  GitRemote as HostGitRemote,
  RecentIssue as HostRecentIssue,
} from "../services/session/gitRemotes";
import type {
  DiffRangeResult as HostDiffRangeResult,
  LogSearchFilters as HostLogSearchFilters,
  LogSearchResult as HostLogSearchResult,
} from "../services/session/gitSearch";
import type { GitStatus as HostGitStatus } from "../services/session/gitStatus";
import type { Submodule as HostSubmodule } from "../services/session/gitSubmodules";
import type { GitTag as HostGitTag } from "../services/session/gitTags";
import type { Worktree as HostWorktree } from "../services/session/gitWorktrees";
import type {
  ArgusConfig as HostArgusConfig,
  ReleaseNotePatternConfig as HostReleaseNotePatternConfig,
  SimulatorDeeplinkConfig as HostSimulatorDeeplinkConfig,
} from "../services/session/models";
import type {
  ReleaseNoteEntry as HostReleaseNoteEntry,
  SessionReleaseNotesResult as HostSessionReleaseNotesResult,
} from "../services/session/releaseNotes";
import type {
  BranchList as HostBranchList,
  GitCommit as HostGitCommit,
  GitStashEntry as HostGitStashEntry,
  GitStashSaveOptions as HostGitStashSaveOptions,
} from "../services/session/sessionOps";
import type {
  MoveWorktreesPlan as HostMoveWorktreesPlan,
  MoveWorktreesResult as HostMoveWorktreesResult,
} from "../services/session/worktreeMove";
import type {
  WorktreeLocationProbe as HostWorktreeLocationProbe,
  WorktreeStorage as HostWorktreeStorage,
} from "../services/session/worktreeStorage";
import type { UserProjectSettings as HostUserProjectSettings } from "../services/userProjectSettings/store";
import type {
  ArgusConfig,
  BisectStatus,
  BisectStep,
  BlameChunk,
  BranchCommitSummary,
  BranchList,
  ConflictBlobs,
  EnrichedBranch,
  FormatPatchResult,
  GitCommit,
  GitCompareResult,
  GitDiffRangeResult,
  GitHook,
  GitHookOutput,
  GitRemote,
  GitRemoteBranch,
  GitRemoteRich,
  GitStashEntry,
  GitStashSaveOptions,
  GitStatus,
  GitSubmodule,
  GitTag,
  GitWorktree,
  LfsFiles,
  LogSearchFilters,
  LogSearchResult,
  MoveWorktreesPlan,
  MoveWorktreesResult,
  PullV2Opts,
  PushV2Opts,
  RebasePlanCommit,
  RebasePlanEntry,
  RecentIssue,
  ReflogEntry,
  ReflogOptions,
  ReleaseNoteEntry,
  ReleaseNotePatternConfig,
  SessionReleaseNotesResult,
  SimulatorDeeplinkConfig,
  SshKey,
  UserProjectSettings,
  WorktreeLocationProbe,
  WorktreeStorage,
} from "@argus/remote-protocol";

export type GitModelChecks = [
  Expect<Equal<BranchList, HostBranchList>>,
  Expect<Equal<BranchCommitSummary, HostBranchCommitSummary>>,
  Expect<Equal<EnrichedBranch, HostEnrichedBranch>>,
  Expect<Equal<GitRemoteBranch, HostRemoteBranch>>,
  Expect<Equal<GitCompareResult, HostCompareResult>>,
  Expect<Equal<GitStatus, HostGitStatus>>,
  Expect<Equal<ConflictBlobs, HostConflictBlobs>>,
  Expect<Equal<GitCommit, HostGitCommit>>,
  Expect<Equal<GitStashEntry, HostGitStashEntry>>,
  Expect<Equal<GitStashSaveOptions, HostGitStashSaveOptions>>,
  Expect<Equal<LogSearchFilters, HostLogSearchFilters>>,
  Expect<Equal<LogSearchResult, HostLogSearchResult>>,
  Expect<Equal<GitDiffRangeResult, HostDiffRangeResult>>,
  Expect<Equal<BlameChunk, HostBlameChunk>>,
  Expect<Equal<ReflogEntry, HostReflogEntry>>,
  Expect<Equal<ReflogOptions, HostReflogOptions>>,
  Expect<Equal<RebasePlanCommit, HostRebasePlanCommit>>,
  Expect<Equal<RebasePlanEntry, HostRebasePlanEntry>>,
  Expect<Equal<BisectStep, HostBisectStep>>,
  Expect<Equal<BisectStatus, HostBisectStatus>>,
  Expect<Equal<GitRemote, HostGitRemote>>,
  Expect<Equal<RecentIssue, HostRecentIssue>>,
  Expect<Equal<GitRemoteRich, HostRemote>>,
  Expect<Equal<GitTag, HostGitTag>>,
  Expect<Equal<GitSubmodule, HostSubmodule>>,
  Expect<Equal<GitWorktree, HostWorktree>>,
  Expect<Equal<SshKey, HostSshKey>>,
  Expect<Equal<LfsFiles, HostLfsFiles>>,
  Expect<Equal<FormatPatchResult, HostFormatPatchResult>>,
  Expect<Equal<GitHook, HostHook>>,
  Expect<Equal<GitHookOutput, HostHookOutput>>,
  Expect<Equal<PushV2Opts, HostPushV2Opts>>,
  Expect<Equal<PullV2Opts, HostPullV2Opts>>,
  Expect<Equal<ArgusConfig, HostArgusConfig>>,
  Expect<Equal<SimulatorDeeplinkConfig, HostSimulatorDeeplinkConfig>>,
  Expect<Equal<ReleaseNotePatternConfig, HostReleaseNotePatternConfig>>,
  Expect<Equal<ReleaseNoteEntry, HostReleaseNoteEntry>>,
  Expect<Equal<SessionReleaseNotesResult, HostSessionReleaseNotesResult>>,
  Expect<Equal<UserProjectSettings, HostUserProjectSettings>>,
  Expect<Equal<MoveWorktreesPlan, HostMoveWorktreesPlan>>,
  Expect<Equal<MoveWorktreesResult, HostMoveWorktreesResult>>,
  Expect<Equal<WorktreeStorage, HostWorktreeStorage>>,
  Expect<Equal<WorktreeLocationProbe, HostWorktreeLocationProbe>>,
];
