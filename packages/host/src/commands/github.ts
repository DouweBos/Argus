import { defineTypedCommand } from "../services/command/registry";
import { listGhIssues } from "../services/github/issues";
import {
  ghPrClose,
  ghPrComment,
  ghPrCreate,
  ghPrMerge,
} from "../services/github/prActions";
import {
  getPullRequestDetail,
  getPullRequestDiff,
} from "../services/github/prDetail";
import { listInterestingPullRequests } from "../services/github/pullRequests";
import { autofillPullRequestBody } from "../services/session/prAutofill";
import { readPullRequestTemplate } from "../services/session/pullRequest";

export function registerGithubCommands(): void {
  defineTypedCommand("list_interesting_pull_requests", (p) =>
    listInterestingPullRequests(p.repoRoots),
  );
  defineTypedCommand("get_pull_request_detail", (p) =>
    getPullRequestDetail(p.owner, p.repo, p.number),
  );
  defineTypedCommand("get_pull_request_diff", (p) =>
    getPullRequestDiff(p.owner, p.repo, p.number),
  );
  defineTypedCommand("read_pr_template", (p) =>
    readPullRequestTemplate(p.repoRoot),
  );
  defineTypedCommand("autofill_pr_template", (p) => autofillPullRequestBody(p));
  defineTypedCommand("gh_pr_create", (p) => ghPrCreate(p));
  defineTypedCommand("gh_pr_comment", (p) => ghPrComment(p));
  defineTypedCommand("gh_pr_merge", (p) => ghPrMerge(p));
  defineTypedCommand("gh_pr_close", (p) => ghPrClose(p));
  defineTypedCommand("gh_list_issues", (p) => listGhIssues(p.repoRoot));
}
