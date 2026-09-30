import type { Equal, Expect } from "./typeEquality";
import type { GhIssue as HostGhIssue } from "../services/github/issues";
import type { MergeStrategy as HostMergeStrategy } from "../services/github/prActions";
import type { ghPrCreate } from "../services/github/prActions";
import type {
  CheckConclusion as HostCheckConclusion,
  CheckStatus as HostCheckStatus,
  InlineReviewComment as HostInlineReviewComment,
  PullRequestCheck as HostPullRequestCheck,
  PullRequestComment as HostPullRequestComment,
  PullRequestCommit as HostPullRequestCommit,
  PullRequestDetail as HostPullRequestDetail,
  PullRequestFile as HostPullRequestFile,
} from "../services/github/prDetail";
import type {
  InterestingPullRequest as HostInterestingPullRequest,
  PullRequestReason as HostPullRequestReason,
} from "../services/github/pullRequests";
import type {
  CheckConclusion,
  CheckStatus,
  CreatedPullRequest,
  GhIssue,
  InlineReviewComment,
  InterestingPullRequest,
  PullRequestCheck,
  PullRequestComment,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestFile,
  PullRequestMergeStrategy,
  PullRequestReason,
} from "@argus/remote-protocol";

export type GithubModelChecks = [
  Expect<Equal<PullRequestReason, HostPullRequestReason>>,
  Expect<Equal<InterestingPullRequest, HostInterestingPullRequest>>,
  Expect<Equal<CheckConclusion, HostCheckConclusion>>,
  Expect<Equal<CheckStatus, HostCheckStatus>>,
  Expect<Equal<PullRequestFile, HostPullRequestFile>>,
  Expect<Equal<PullRequestCommit, HostPullRequestCommit>>,
  Expect<Equal<PullRequestCheck, HostPullRequestCheck>>,
  Expect<Equal<InlineReviewComment, HostInlineReviewComment>>,
  Expect<Equal<PullRequestComment, HostPullRequestComment>>,
  Expect<Equal<PullRequestDetail, HostPullRequestDetail>>,
  Expect<Equal<PullRequestMergeStrategy, HostMergeStrategy>>,
  Expect<Equal<CreatedPullRequest, Awaited<ReturnType<typeof ghPrCreate>>>>,
  Expect<Equal<GhIssue, HostGhIssue>>,
];
