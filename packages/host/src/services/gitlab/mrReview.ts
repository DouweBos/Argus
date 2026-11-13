/**
 * A review on a GitLab merge request. GitLab has no single review object, so
 * each draft becomes a diff discussion on its line, the summary a note, and an
 * approval the approve endpoint. "Request changes" is said in the note.
 */

import type { RepoRef } from "../codeHost/remoteUrl";
import type { PullRequestReview } from "../github/prReview";
import { glabRest } from "./glab";
import { mrPath } from "./mrActions";

interface DiffRefs {
  base_sha: string;
  head_sha: string;
  start_sha: string;
}

export async function reviewMergeRequest(
  ref: RepoRef,
  number: number,
  review: PullRequestReview,
): Promise<void> {
  const path = mrPath(ref, number);
  if (review.comments.length > 0) {
    const mr = await glabRest<{ diff_refs: DiffRefs }>(ref.host, path);
    for (const comment of review.comments) {
      // A range anchors on its last line; GitLab's multi-line positions need line codes.
      await glabRest(ref.host, `${path}/discussions`, {
        method: "POST",
        fields: {
          body: comment.body,
          "position[position_type]": "text",
          "position[base_sha]": mr.diff_refs.base_sha,
          "position[start_sha]": mr.diff_refs.start_sha,
          "position[head_sha]": mr.diff_refs.head_sha,
          "position[old_path]": comment.path,
          "position[new_path]": comment.path,
          [comment.side === "LEFT"
            ? "position[old_line]"
            : "position[new_line]"]: comment.line,
        },
      });
    }
  }
  const summary =
    review.event === "REQUEST_CHANGES"
      ? `**Changes requested.**${review.body ? `\n\n${review.body}` : ""}`
      : review.body;
  if (summary) {
    await glabRest(ref.host, `${path}/notes`, {
      method: "POST",
      fields: { body: summary },
    });
  }
  if (review.event === "APPROVE") {
    await glabRest(ref.host, `${path}/approve`, { method: "POST" });
  }
}
