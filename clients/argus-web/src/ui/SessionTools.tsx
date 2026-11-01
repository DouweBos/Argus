/**
 * A session's files, search, terminals and per-file diffs. Loaded on demand
 * (`MonitorPanes`), so the chat-only path doesn't carry them.
 */

import type { Screen } from "../routing/screens";
import { FileDiffView } from "./FileDiffView";
import { FileScreen } from "./FileScreen";
import { FileSearchScreen } from "./FileSearchScreen";
import { QuickOpen } from "./QuickOpen";
import { TerminalsView } from "./TerminalsView";

export type ToolScreen = Extract<
  Screen,
  { name: "file" | "fileDiff" | "files" | "search" | "terminals" }
>;

export default function SessionToolBody({ screen }: { screen: ToolScreen }) {
  switch (screen.name) {
    case "files":
      return (
        <QuickOpen
          key={screen.sessionId}
          sessionId={screen.sessionId}
          via="screen"
        />
      );
    case "file":
      return (
        <FileScreen
          key={`${screen.sessionId}\u0000${screen.path}`}
          sessionId={screen.sessionId}
          path={screen.path}
          line={screen.line}
        />
      );
    case "search":
      return <FileSearchScreen sessionId={screen.sessionId} />;
    case "terminals":
      return (
        <TerminalsView
          sessionId={screen.sessionId}
          terminalId={screen.terminalId}
        />
      );
    case "fileDiff":
      return (
        <FileDiffView
          sessionId={screen.sessionId}
          mode={screen.mode}
          path={screen.path}
        />
      );
  }
}
