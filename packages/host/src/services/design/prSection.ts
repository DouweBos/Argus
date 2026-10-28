/**
 * What a pull request opened from Argus says about where the work came from:
 * the ticket and the design frames it was built against.
 */

import { appState } from "../../state";

export function prReferenceSection(
  repoRoot: string,
  head: string,
): string | null {
  const session = [...appState.sessions.values()].find(
    (s) => s.repo_root === repoRoot && s.branch === head,
  );
  const issue = session?.linked_issue;
  const designs = session?.design_refs ?? [];
  if (!issue && designs.length === 0) {
    return null;
  }
  const lines = ["---", ""];
  if (issue) {
    lines.push(
      `**Ticket:** [${issue.identifier} ${issue.title}](${issue.url})`,
    );
  }
  if (designs.length > 0) {
    lines.push(
      `**Design:** ${designs.map((d) => `[${d.name}](${d.url})`).join(", ")}`,
    );
  }
  if (issue && designs.length > 0) {
    lines.push("", "Design vs. implementation screenshots are on the ticket.");
  }

  return lines.join("\n");
}
