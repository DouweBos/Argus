/**
 * The prompts Argus's own one-shot `claude -p` helpers open with. A transcript
 * that starts with one is Argus talking to itself, never a chat to import.
 */

import { AUTHORING_PROMPT, REVISION_PROMPT } from "../automation/authoring";
import {
  BRANCH_AND_TITLE_PROMPT,
  CHAT_TITLE_PROMPT,
  SESSION_TITLE_PROMPT,
} from "../llm/titleGenerator";
import { REFINE_ARGUS_JSON_PROMPT } from "../onboarding/refineWithClaude";
import {
  PR_DESCRIPTION_PROMPT,
  PR_TEMPLATE_PROMPT,
} from "../session/prAutofill";
import { INJECTION_SCAN_PROMPT } from "../signals/injectionScan";

const HELPER_PROMPTS = [
  SESSION_TITLE_PROMPT,
  BRANCH_AND_TITLE_PROMPT,
  CHAT_TITLE_PROMPT,
  PR_TEMPLATE_PROMPT,
  PR_DESCRIPTION_PROMPT,
  AUTHORING_PROMPT,
  REVISION_PROMPT,
  INJECTION_SCAN_PROMPT,
  REFINE_ARGUS_JSON_PROMPT,
];

/** Also matches a title cut from the prompt's first line: every opening fits in one. */
export function isArgusHelperPrompt(text: string): boolean {
  const opening = text.trimStart();

  return HELPER_PROMPTS.some((p) => opening.startsWith(p));
}
