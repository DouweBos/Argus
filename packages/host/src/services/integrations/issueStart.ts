/**
 * What an agent started from a Linear issue gets, for clients that hand the
 * host an issue rather than building the prompt themselves (the phone and the
 * Mac app). Same shape as the desktop composer's `startPrompt`.
 */

import type {
  DesignRef,
  ImageAttachment,
  LinearIssueContext,
  LinkedIssue,
} from "@argus/remote-protocol";
import { figmaApi, figmaDesignRef } from "./figma/service";
import { linearIssueContext } from "./service";

const ISSUE_ONLY_PROMPT = "Work on this issue.";

function designSection(designs: DesignRef[]): string | null {
  if (designs.length === 0) {
    return null;
  }

  return [
    "## Design",
    "",
    "Match these Figma frames. Call `figma_get_frame` with each link for the image, layers and designer notes, and compare a simulator screenshot against the frame before you call the work done.",
    "",
    ...designs.map((d) => `- ${d.name}: ${d.url}`),
  ].join("\n");
}

/** The issue's context, then the designs to match, then what the user typed (or a default ask). */
export function issueStartPrompt(
  context: LinearIssueContext,
  designs: DesignRef[],
  prompt: string,
): string {
  const sections = [context.context, designSection(designs)].filter(
    (section) => section !== null,
  );

  return [...sections, prompt.trim() || ISSUE_ONLY_PROMPT].join("\n\n");
}

export interface IssueStart {
  branch: string;
  description: string;
  linkedIssue: LinkedIssue;
  designRefs: DesignRef[];
  prompt: string;
  images: ImageAttachment[];
}

/** Figma links in the issue, resolved when Figma is connected; one that fails is dropped. */
async function issueDesigns(urls: string[]): Promise<DesignRef[]> {
  if (urls.length === 0 || !figmaApi()) {
    return [];
  }
  const refs = await Promise.all(
    urls.map((url) => figmaDesignRef(url).catch(() => null)),
  );

  return refs.filter((r) => r !== null);
}

/** Throws a sentence when Linear has no such issue. */
export async function prepareIssueStart(
  ref: string,
  prompt: string,
): Promise<IssueStart> {
  const context = await linearIssueContext(ref);
  if (!context) {
    throw `Linear has no issue ${ref}.`;
  }
  const { issue } = context;
  const designRefs = await issueDesigns(context.designUrls);

  return {
    branch: issue.branchName,
    description: `${issue.identifier} ${issue.title}`,
    linkedIssue: {
      source: "linear",
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
    },
    designRefs,
    prompt: issueStartPrompt(context, designRefs, prompt),
    images: context.images,
  };
}
