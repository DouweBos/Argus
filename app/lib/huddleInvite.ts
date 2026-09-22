/**
 * The text an engineer pastes into Slack when they share an agent.
 *
 * A bare link says nothing: the recipient sees a UUID and has to be told, in a
 * second message, who sent it and what it opens. The invite carries both.
 */

export interface HuddleInvite {
  /** The agent's title. Empty for an agent that hasn't earned one yet. */
  agentTitle: string;
  /** Whoever is sharing. Empty when we have no name to use. */
  name: string;
  /** The room link. Empty while the tunnel is still coming up. */
  url: string;
}

/** What the invite calls an agent with no title of its own yet. */
const UNTITLED = "an agent";

/**
 * Build the invite. Degrades a phrase at a time rather than all at once: no
 * name still names the agent, no title still names the sender, and neither
 * still hands over a working link.
 */
export function huddleInviteText({
  name,
  agentTitle,
  url,
}: HuddleInvite): string {
  const who = name.trim();
  const what = agentTitle.trim();
  const subject = what ? `“${what}”` : UNTITLED;
  const sentence = who
    ? `${who} wants you to join ${subject} in Argus`
    : `You're invited to join ${subject} in Argus`;

  return url ? `${sentence} — ${url}` : sentence;
}
