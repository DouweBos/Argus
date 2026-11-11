/**
 * What a pane's top bar calls its screen. The URL carries ids only, so names
 * come from whatever the stores already hold, with a neutral fallback while
 * they load.
 */

import { fileNameOf } from "@argus/client-core";
import type { RemoteAgentStatus } from "../lib/protocol";
import { projectKey, type Screen } from "../routing/screens";
import { SETTINGS_PAGE_TITLES } from "./settings/pages";
import { useAgentsStore } from "../stores/agents";
import { useChatsStore } from "../stores/chats";
import { useAutomationsStore } from "../stores/automations";
import { useDesignStore } from "../stores/design";
import { useDevicesStore } from "../stores/devices";
import { useProjectsStore } from "../stores/projects";
import { useProposalsStore } from "../stores/proposals";

export function agentLabel(
  agentId: string,
  agent: Pick<RemoteAgentStatus, "title"> | undefined,
): string {
  return agent?.title?.trim() || `Agent ${agentId.slice(0, 8)}`;
}

export function useScreenTitle(screen: Screen): string {
  const projects = useProjectsStore((s) => s.projects);
  const sessionsByRepo = useProjectsStore((s) => s.sessionsByRepo);
  const recentAgents = useProjectsStore((s) => s.recentAgents);
  const statusByAgent = useAgentsStore((s) => s.statusByAgent);
  const devices = useDevicesStore((s) => s.devices);
  const stoppedByRepo = useChatsStore((s) => s.stoppedByRepo);
  const frameName = useDesignStore((s) =>
    screen.name === "design" ? s.frames[screen.url]?.details?.frame.name : null,
  );
  const sessionLabel = (sessionId: string) => {
    const session = Object.values(sessionsByRepo)
      .flat()
      .find((s) => s.id === sessionId);

    return session?.display_name ?? session?.branch ?? null;
  };
  const automations = useAutomationsStore((s) => s.automations);
  const runs = useAutomationsStore((s) => s.runs);
  const proposal = useProposalsStore((s) =>
    screen.name === "proposal" ? s.detailById[screen.proposalId] : undefined,
  );

  function withSession(title: string, sessionId: string): string {
    const session = Object.values(sessionsByRepo)
      .flat()
      .find((s) => s.id === sessionId);
    const label = session?.display_name ?? session?.branch;

    return label ? `${title} · ${label}` : title;
  }

  switch (screen.name) {
    case "projects":
      return "Projects";
    case "project":
      return (
        projects.find((p) => projectKey(p.repo_root) === screen.projectKey)
          ?.name ?? "Project"
      );
    case "settings":
      return "Settings";
    case "settingsPage":
      return SETTINGS_PAGE_TITLES[screen.page];
    case "usage":
      return "Usage";
    case "usageModel":
      return screen.model;
    case "usagePrices":
      return "Model prices";
    case "notifications":
      return "Notifications";
    case "design":
      return frameName ?? "Design";
    case "issues":
      return screen.issueRef ?? "Issues";
    case "devices":
      return "Devices";
    case "device":
      return (
        devices.find(
          (d) => d.id === screen.deviceKey && d.platform === screen.platform,
        )?.name ?? "Device"
      );
    case "session":
      return "Session";
    case "agent":
      return agentLabel(
        screen.agentId,
        statusByAgent[screen.agentId] ??
          recentAgents.find((a) => a.agent_id === screen.agentId),
      );
    case "changes":
      return withSession("Changes", screen.sessionId);
    case "files":
      return withSession("Files", screen.sessionId);
    case "search":
      return withSession("Search", screen.sessionId);
    case "terminals":
      return withSession("Terminals", screen.sessionId);
    case "browser":
      return withSession("Browser", screen.sessionId);
    case "file":
    case "fileDiff":
      return fileNameOf(screen.path);
    case "sessionHome":
      return sessionLabel(screen.sessionId) ?? "Session";
    case "chat":
      return (
        Object.values(stoppedByRepo)
          .flat()
          .find((c) => c.history_id === screen.historyId)
          ?.title.trim() || "Saved chat"
      );
    case "inbox":
      return "Inbox";
    case "proposal":
      return proposal?.title ?? "Proposal";
    case "automations":
      return "Automations";
    case "automation":
      return (
        automations.find((a) => a.id === screen.automationId)?.name ??
        "Automation"
      );
    case "automationRun":
    case "quickRunDetail":
      return runs.find((r) => r.id === screen.runId)?.automation_name ?? "Run";
    case "quickRun":
      return "Quick Run";
    case "describe":
      return "Describe an Automation";
    case "branches":
      return withSession("Branches", screen.sessionId);
    case "branch":
      return screen.ref;
    case "compare":
      return `${screen.left} ↔ ${screen.right}`;
    case "stashes":
      return withSession("Stashes & Tags", screen.sessionId);
    case "commit":
      return screen.hash.slice(0, 8);
    case "pullRequests":
      return "Pull Requests";
    case "pullRequest":
      return `${screen.repo} #${screen.number}`;
  }
}
