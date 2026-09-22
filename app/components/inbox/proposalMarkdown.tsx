import { Markdown } from "../shared/Markdown";

/**
 * Proposal bodies are markdown written by the run that raised them. Peacock's
 * prose styles carry the layout; the card's className tunes size and color.
 */
export function renderProposalMarkdown(text: string, className?: string) {
  return <Markdown baseProse className={className} text={text} />;
}
