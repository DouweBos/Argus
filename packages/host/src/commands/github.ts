import {
  closePullRequest,
  commentOnPullRequest,
  createPullRequest,
  getPullRequestDetail,
  getPullRequestDiff,
  listInterestingPullRequests,
  listIssues,
  mergePullRequest,
} from "../services/codeHost/pullRequests";
import { defineTypedCommand } from "../services/command/registry";
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
  defineTypedCommand("gh_pr_create", (p) => createPullRequest(p));
  defineTypedCommand("gh_pr_comment", (p) => commentOnPullRequest(p));
  defineTypedCommand("gh_pr_merge", (p) => mergePullRequest(p));
  defineTypedCommand("gh_pr_close", (p) => closePullRequest(p));
  defineTypedCommand("gh_list_issues", (p) => listIssues(p.repoRoot));
}
