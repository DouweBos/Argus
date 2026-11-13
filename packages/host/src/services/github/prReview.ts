/**
 * A pull request review with inline comments, posted as one through
 * `gh api` — `gh pr review` can't attach line comments.
 */

import type { RemotePullRequestReviewComment } from "@argus/remote-protocol";
import { execFile } from "node:child_process";

export type ReviewEvent = "APPROVE" | "COMMENT" | "REQUEST_CHANGES";

function ghApi(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "gh",
      args,
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = `${stderr || err.message}`.trim();
          if (msg.includes("ENOENT")) {
            reject(
              "gh CLI is not installed. Install it from https://cli.github.com and run `gh auth login`.",
            );
          } else if (/not logged into|authentication|HTTP 401/.test(msg)) {
            reject(
              "Not authenticated with GitHub. Run `gh auth login` to sign in.",
            );
          } else {
            reject(msg);
          }
        } else {
          resolve(stdout);
        }
      },
    );
    child.stdin?.end(input);
  });
}

export interface PullRequestReview {
  event: ReviewEvent;
  body: string;
  comments: RemotePullRequestReviewComment[];
}

/** `repo` is `owner/name`. */
export async function ghPrReview(
  repo: string,
  number: number,
  review: PullRequestReview,
): Promise<void> {
  const payload = {
    event: review.event,
    body: review.body,
    comments: review.comments.map((c) => ({
      path: c.path,
      side: c.side,
      line: c.line,
      ...(c.start_line && c.start_line < c.line
        ? { start_line: c.start_line, start_side: c.side }
        : {}),
      body: c.body,
    })),
  };
  await ghApi(
    [
      "api",
      "--method",
      "POST",
      `repos/${repo}/pulls/${number}/reviews`,
      "--input",
      "-",
    ],
    JSON.stringify(payload),
  );
}
