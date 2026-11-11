import type { ReactNode } from "react";
import { CommandMessage, type CommandArgumentLink } from "@argus/peacock";
import type { RemoteMessageCommand } from "../../lib/protocol";
import { appNavigate, screenHref } from "../../routing/router";
import type { Screen } from "../../routing/screens";
import { ARGUS_COMMANDS } from "../../telemetry/events";
import { capture } from "../../telemetry/telemetry";
import { commandArgumentTarget } from "./commandArgument";

function argumentLink(argument: string): CommandArgumentLink | undefined {
  const target = commandArgumentTarget(argument);
  if (target?.kind === "issue") {
    const screen: Screen = {
      name: "issues",
      scope: "assigned",
      query: null,
      issueRef: target.identifier,
    };

    return { href: screenHref(screen), onClick: () => appNavigate(screen) };
  }
  if (target?.kind === "url") {
    return { href: target.href, external: true };
  }

  return undefined;
}

/** A recognized slash command, drawn in place of the text the user typed. */
export function CommandContent({
  command,
  renderMarkdown,
}: {
  command: RemoteMessageCommand;
  renderMarkdown: (text: string) => ReactNode;
}) {
  const argusCommand = ARGUS_COMMANDS.find((c) => c === command.name);

  return (
    <CommandMessage
      argument={command.argument}
      argumentLink={command.argument ? argumentLink(command.argument) : undefined}
      name={command.name}
      notes={command.notes}
      prompt={command.kind === "argus" ? command.prompt : undefined}
      renderMarkdown={renderMarkdown}
      onPlaybookOpenChange={(open) => {
        if (open && argusCommand) {
          capture("web_transcript_playbook_opened", { command: argusCommand });
        }
      }}
    />
  );
}
